/*
Copyright (c) 2010 Tim Caswell <tim@creationix.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var sys = require('sys');
require.paths.unshift(__dirname + "/wheat");
require('proto');

var ChildProcess = require('child_process'),
    path = require('path'),
    sys = require('sys'),
    fs = require('fs'),
    Git = require('git'),
    Haml = require('haml'),
    Markdown = require('markdown'),
    Step = require('step'),
    NodeRouter = require('node-router'),
    Prettify = require('prettify'),
    Graphviz = require('graphviz'),
    MD5 = require('md5');

// Extracts the special headers out of an extended markdown document
function markdownPreParse(markdown) {
  var match;
  var props = {};
  while(match = markdown.match(/^([a-z]+):\s*(.*)\s*\n/i)) {
    var name = match[1].toLowerCase(),
        value = match[2];
    markdown = markdown.substr(match[0].length);
    props[name] = value;
  }
  props.markdown = markdown;
  return props;
}

// Turns any async function that takes a single name argument and a callback
// into an async safe function where there will never be two concurrent
// invocations of the same named job. Think of it as a short term cache
// or a semaphore type thingy.
function safe(fn) {
  var locks = {};
  return function (name, callback) {
    var list;
    // Defer the request if the same one is already going
    if (list = locks[name]) {
      list.push(callback);
      return;
    }
    // Start a list with this call
    list = locks[name] = [callback];
    // Call the real function
    fn(name, function () {
      // Pass the result to all the wating calls
      for (var i = 0, l = list.length; i < l; i++) {
        list[i].apply(null, arguments);
      }
      // Remove the list
      delete locks[name];
    });
  }
}

// Safely loads and compiles a template from the skin folder.
var loadTemplate = safe(Step.fn(
  function (name) {
    Git.readFile("skin/" + name + ".haml", this);
  },
  function (err, haml) {
    if (err) throw err;
    return Haml(haml);
  }
));

// Load and execute a template.
function renderTemplate(name, data, callback) {
  // Data is optional
  if (typeof data === 'function' && typeof callback === 'undefined') {
    callback = data;
    data = {};
  }

  // Add in the helpers
  data.__proto__ = Helpers;

  Step(
    function () {
      loadTemplate(name, this);
    },
    function (err, fn) {
      if (err) throw err;
      return fn(data);
    },
    callback
  );
}

var renderDot = safe(Step.fn(
  function renderDot(path) {
    Git.readFile("articles/" + path, this);
  },
  function (err, dotData) {
    if (err) throw err;
    Graphviz(dotData, this);
  }
));

var loadArticle = safe(Step.fn(
  function (name) {
    this._name = name;
    Git.readFile(path.join("articles", name + ".markdown"), this);
  },
  function (err, markdown) {
    if (err) throw err;
    var props = this._props = markdownPreParse(markdown);
    props.name = this._name;
    loadAuthor(props.author, this);
  },
  function (err, author) {
    if (err) throw err;
    this._props.author = author;
    return this._props;
  }
));


var loadAuthor = safe(Step.fn(
  function (name) {
    this._name = name;
    Git.readFile(path.join("authors", name + ".markdown"), this);
  },
  function (err, markdown) {
    if (err) throw err;
    var props = markdownPreParse(markdown);
    props.name = this._name;
    return props;
  }
));


// Reads the authors in the authors directory and returns a data structure
var loadArticles = Step.fn(
  function getFileNames() {
    Git.readDir("articles", this);
  },
  function readFileContents(err, results) {
    if (err) throw err;
    var parallel = this.parallel;
    results.files.forEach(function (filename) {
      var name = filename.replace(/\.markdown$/, '');
      loadArticle(name, parallel());
    });
  },
  function parseFileContents(err) {
    if (err) throw err;
    return Array.prototype.slice.call(arguments, 1);
  }
);

// Generic page renderer with layout
function render(request, response, data) {
  renderTemplate("layout", data, function(err, html) {
    if (err) {
      response.simpleText(500, err.stack);
      return;
    }
    if (cacheDir) {
      var cacheFile = path.join(cacheDir, request.url.replace(/\/$/, '/index.html'));
      sys.puts("Saving cache file: " + cacheFile);
      fs.writeFile(cacheFile, html);
    }

    response.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "max-age=300",
      "Expires": new Date((new Date()).getTime() + 300),
      "Content-Length": html.length
    });
    response.write(html);
    response.end();
  });

}

// Does a custom compile of the markdown pulling in external code snippets
function compileMarkdown(markdown, dataDir, callback) {
  // TODO: actually pull in snippets relative to dataDir
  process.nextTick(function () {
    callback(null, Markdown.encode(markdown));
  });
}

var Helpers = {
  intro: function (markdown) {
    var html = Markdown.encode(markdown);
    return html.substr(0, html.indexOf("<h2"));
  },
  markdownEncode: function (markdown) {
    return Markdown.encode(markdown);
  },
  github: function (name) {
    return '<a href="http://github.com/' + name + '">' + name + '</a>';
  },
  bitbucket: function (name) {
    return '<a href="http://bitbucket.com/' + name + '">' + name + '</a>';
  },
  twitter: function (name) {
    return '<a href="http://twitter.com/' + name + '">' + name + '</a>';
  },
  gravitar: function (email, size) {
    size = size || 200
    return "http://www.gravatar.com/avatar/" +
      MD5.md5(email.trim().toLowerCase()) +
      "?r=pg&s=" + size + ".jpg&d=identicon";
  },
  format_date: function (date, format) {
    var date = new Date(date),
        match, value;
    while (match = format.match(/(%[a-z])/i)) {
      switch (match[1]) {
        case "%d":
          value = date.getDate();
          break;
        case "%m":
          value = date.getMonth() + 1;
          break;
        case "%Y":
          value = date.getFullYear();
          break;
        case "%H":
          value = date.getHours();
          break;
        case "%M":
          value = date.getMinutes();
          break;
        case "%S":
          value = date.getSeconds();
          break;
        default:
          value = "";
          break;
      }
      format = format.replace(match[1], value);
    }
    return format;
  }
};

var cacheDir;
var Wheat = module.exports = function Wheat(repo, port) {
  Git(repo); // Connect to the git repo

  // Detect if a cache directory exist.  If it does, then use it.
  var cachePath =  path.join(repo, "cache");
  fs.stat(cachePath, function (err, stat) {
    if (err) return;
    cacheDir = cachePath;
    sys.puts("Using cacheDir: " + cacheDir);
  });

  var server = NodeRouter.getServer();

  // Renders an overview page
  server.get("/", function (request, response) {

    Step(
      function loadData() {
        loadArticles(this.parallel());
        Git.readFile("description.markdown", this.parallel());
      },
      function renderContent(err, articles, description) {
        if (err) return response.simpleText(500, err.stack);
        var data = {
          articles: articles,
          description: description
        };
        renderTemplate('index', data, this);
      },
      function showPage(err, content) {
        if (err) return response.simpleText(500, err.stack);
        render(request, response, {
          title: "Index",
          content: content
        });
      }
    )

  });

  // Compiles and renders graphviz dot files
  server.get(/^\/(.*\.dot)$/, function (request, response, path) {

    renderDot(path, function (err, data) {
     response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": data.length
      });
      response.write(data, 'binary');
      response.end();
    });
  });

  server.get(/^\/([a-z-]+)$/, function (request, response, name) {
    var props;
    Step(
      function () {
        loadArticle(name, this);
      },
      function (err, article) {
        if (err) throw err;
        props = article;
        compileMarkdown(props.markdown, path.join("articles", name), this.parallel());
        Git.readFile("description.markdown", this.parallel());
      },
      function (err, html, description) {
        if (err) throw err;
        html = html.replace(/<pre><code>[^<]+<\/code><\/pre>/g, function (code) {
          var code = code.match(/<code>([\s\S]+)<\/code>/)[1];
          code = Prettify.prettyPrintOne(code)
          return "<pre><code>" + code + "</code></pre>";
        });
        props.content = html;
        props.description = description;
        renderTemplate("article", props, this);
      },
      function (err, content) {
        if (err) return response.simpleText(500, err.stack);
        render(request, response, {
          title: props.title,
          content: content
        });
      }
    )
  });
  // Load static files from the "skin/public/" folder of the git repo.


  var eCache = {};
  server.get(/^\/(.*\.[a-z]{2,4})$/, function (request, response, filename) {
    var type = NodeRouter.mime.getMime(filename);
    var encoding = (type.substr(0,4) === "text" ? "utf8" : "binary");
    var stream = Git.createReadStream("skin/public/" + filename);
    var first = true;
    var cacheStream;
    var cachePath;

    // We're using strong caching on all static files by filename
    // So don't update a file's contents, rename it.
    var etag = MD5.md5(filename);
    if (eCache[etag]) {
      response.writeHead(304, {
        "Content-Type": type,
        "Server": "Wheat (node.js)",
        'Cache-Control': 'public, max-age=32000000',
        "Date": (new Date()).toUTCString(),
        "ETag": etag
      });
      response.end();
      return;
    }

    stream.addListener("error", function () {
      stream = Git.createReadStream("articles/" + filename);
      stream.addListener("error", function (err) {
        response.notFound(err.message);
      });
      // TODO: implement this in some DRY manner.
    });
    // TODO: use pump so we don't overload the kernel buffer in high load.
    stream.addListener('data', function (buffer) {
      if (first) {
        eCache[etag] = true;
        response.writeHead(200, {
          "Content-Type": type,
          "Server": "Wheat (node.js)",
          'Cache-Control': 'public, max-age=32000000',
          "Date": (new Date()).toUTCString(),
          "ETag": etag
        });

        if (cacheDir) {
          cachePath = path.join(cacheDir, filename) + ".part";
          cacheStream = fs.createWriteStream(cachePath, {
            encoding: stream.encoding
          });
        }
        first = false;
      }
      response.write(buffer, stream.encoding);
      if (cacheStream) {
        cacheStream.write(buffer);
      }
    });
    stream.addListener('end', function () {
      response.end();
      if (cacheStream) {
        cacheStream.end();
        fs.rename(cachePath, cachePath.substr(0, cachePath.length - 5));
      }
    });
  });

  server.listen(port, "0.0.0.0");
};

