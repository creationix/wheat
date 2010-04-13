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

require.paths.unshift(__dirname + "/wheat");
require('proto');
var ChildProcess = require('child_process'),
    Path = require('path'),
    sys = require('sys'),
    fs = require('fs'),
    Git = require('git'),
    Haml = require('haml'),
    Markdown = require('markdown'),
    Step = require('step'),
    NodeRouter = require('node-router'),
    Prettify = require('prettify'),
    Graphviz = require('graphviz'),
    MD5 = require('md5'),
    Buffer = require('buffer').Buffer;

var Data;
(function dataSources() {

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

  // These are our data sources
  Data = {

    // Loads the core data for a single article.
    article: Git.safe(function (version, name, callback) {
      Step(
        function getArticleMarkdown() {
          this._name = name;
          Git.readFile(version, Path.join("articles", name + ".markdown"), this);
        },
        function parseAndGetAuthor(err, markdown) {
          if (err) { callback(err); return; }
          var props = this._props = markdownPreParse(markdown);
          props.name = this._name;
          Data.author(version, props.author, this);
        },
        function finish(err, author) {
          if (err) { callback(err); return; }
          this._props.author = author;
          return this._props;
        },
        callback
      );
    }),

    // Loads the core data for a single author.
    author: Git.safe(function (version, name, callback) {
      Step(
        function getAuthorMarkdown() {
          this._name = name;
          Git.readFile(version, Path.join("authors", name + ".markdown"), this);
        },
        function parseAndFinish(err, markdown) {
          if (err) { callback(err); return; }
          var props = markdownPreParse(markdown);
          props.name = this._name;
          return props;
        },
        callback
      );
    }),

    // Loads the core data for all the articles and sorts the list by date.
    articles: Git.safe(function (version, callback) {
      Step(
        function getListOfArticles() {
          Git.readDir(version, "articles", this);
        },
        function readArticles(err, results) {
          if (err) { callback(err); return; }
          var parallel = this.parallel;
          results.files.forEach(function (filename) {
            var name = filename.replace(/\.markdown$/, '');
            Data.article(version, name, parallel());
          });
        },
        function sortAndFinish(err) {
          if (err) { callback(err); return; }
          var articles = Array.prototype.slice.call(arguments, 1);
          articles.sort(function (a, b) {
            return (Date.parse(b.date)) - (Date.parse(a.date));
          });
          return articles;
        },
        callback
      )
    })

  };

}());

var Renderers;
(function pageRenderers() {

  // Convert UTF8 strings to binary buffers for faster loading
  function stringToBuffer(string) {
    var buffer = new Buffer(Buffer.byteLength(string));
    buffer.utf8Write(string);
    return buffer;
  }

  // Loads a haml template and caches in memory.
  var loadTemplate = Git.safe(function loadTemplate(version, name, callback) {
    Step(
      function loadTemplate() {
        Git.readFile(version, "skin/" + name + ".haml", this);
      },
      function compileTemplate(err, haml) {
        if (err) { callback(err); return; }
        return Haml(haml);
      },
      callback
    );
  });

  function render(name, data, callback, partial) {
    Step(
      function getHead() {
        Git.getHead(this);
      },
      function loadTemplates(err, version) {
        if (err) { callback(err); return; }
        loadTemplate(version, name, this.parallel());
        if (!partial) {
          loadTemplate(version, "layout", this.parallel());
        }
      },
      function renderTemplates(err, template, layout) {
        if (err) { callback(err); return; }
        data.__proto__ = Helpers;
        var content = template(data);
        if (partial) { return stringToBuffer(content); }
        data = {
          content: content,
          title: data.title || ""
        };
        data.__proto__ = Helpers;
        return stringToBuffer(layout(data));
      },
      callback
    )
  }

  Renderers = {
    index: Git.safe(function index(version, callback) {
      Step(
        function loadData() {
          Data.articles(version, this.parallel());
          Git.readFile(version, "description.markdown", this.parallel());
        },
        function applyTemplate(err, articles, description) {
          if (err) { callback(err); return; }
          render("index", {
            articles: articles,
            description: description
          }, this);
        },
        callback
      );
    }),

    feed: Git.safe(function feed(version, callback) {
      Step(
        function loadData() {
          Data.articles(version, this);
        },
        function applyTemplate(err, articles) {
          if (err) { callback(err); return; }
          render("feed", {
            articles: articles
          }, this, true);
        },
        callback
      );
    }),

    article: Git.safe(function article(version, name, callback) {
      Step(
        function loadData() {
          Data.article(version, name, this.parallel());
          Git.readFile(version, "description.markdown", this.parallel());
        },
        function applyTemplate(err, article, description) {
          if (err) { callback(err); return; }
          render("article", {
            title: article.title,
            article: article,
            author: article.author,
            description: description
          }, this);
        },
        callback
      );
    }),

    staticFile: Git.safe(function (version, path, callback) {
      Step(
        function loadPublicFiles() {
          Git.readFile(version, "skin/public/" + path, this);
        },
        function loadArticleFiles(err, data) {
          if (err) {
            Git.readFile(version, "articles/" + path, this);
          }
          return data;
        },
        function processFile(err, data) {
          if (err) { callback(err); return; }
          return stringToBuffer(data);
        },
        callback
      );
    }),

    dotFile: Git.safe(function (version, path, callback) {
      callback(null, stringToBuffer("<h1>Dot File " + path + "</h1>\n" + version));
    })
  }

}());

var Helpers = {
  intro: function (markdown) {
    var html = Markdown.encode(markdown);
    return html.substr(0, html.indexOf("<h2"));
  },
  markdownEncode: function (markdown) {
    return Markdown.encode(markdown+"").replace(/\n\n+/g, '');
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

var Wheat = module.exports = function Wheat(repo, port, host) {
  Git(repo); // Connect to the git repo

  var server = NodeRouter.getServer();

  function addRoute(matcher, renderer, cacheLength) {
    server.get(matcher, function (request, response) {
      var args = Array.prototype.slice.call(arguments, 2);
      args.push(function (err, html) {
        if (err) { response.simpleText(500, err.stack); return; }
        response.simpleHtml(200, html);
      });
      if (args[0] === '') {
        Git.getHead(function (err, sha) {
          if (err) { throw err; }
          args[0] = sha;
          renderer.apply(this, args);
        });
        return;
      }
      renderer.apply(this, args);
    });
  }

  // Define our routes
  addRoute(/^\/()$/, Renderers.index);
  addRoute(/^\/()feed.xml$/, Renderers.feed);
  addRoute(/^\/()([a-z0-9_-]+)$/, Renderers.article);
  addRoute(/^\/([a-f0-9]{40})\/([a-z0-9_-]+)$/, Renderers.article);
  addRoute(/^\/()([a-z0-9_-]+\.dot)$/, Renderers.dotFile);
  addRoute(/^\/()([a-z0-9_-]+\.[a-z]{2,4})$/, Renderers.staticFile);
  addRoute(/^\/([a-f0-9]{40})\/([a-z0-9_-]+\.dot)$/, Renderers.dotFile);
  addRoute(/^\/([a-f0-9]{40})\/([a-z0-9_-]+\.[a-z]{2,4})$/, Renderers.staticFile);

  server.listen(port, host);
};





//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
/*


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


// Generic page renderer with layout
function render(request, response, data) {
  renderTemplate("layout", data, function(err, html) {
    if (err) {
      response.simpleText(500, err.stack);
      return;
    }
    if (cacheDir) {
      var cacheFile = Path.join(cacheDir, request.url.replace(/\/$/, '/index.html'));
      sys.puts("Saving cache file: " + cacheFile);
      fs.writeFile(cacheFile, html);
    }

    response.writeHead(200, {
      "Content-Type": "text/html",
      "X-Powered-By": "Wheat (node.js)",
      "Cache-Control": "public, max-age=300",
      "Date": (new Date()).toUTCString(),
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
    var html = Markdown.encode(markdown)
    html = html.replace(/<pre><code>[^<]+<\/code><\/pre>/g, function (code) {
      var code = code.match(/<code>([\s\S]+)<\/code>/)[1];
      code = Prettify.prettyPrintOne(code)
      return "<pre><code>" + code + "</code></pre>";
    });
    callback(null, html.replace(/\n\n+/g, ''));
  });
}


var cacheDir;
var Wheat = module.exports = function Wheat(repo, port) {
  Git(repo); // Connect to the git repo

  // Detect if a cache directory exist.  If it does, then use it.
  var cachePath =  Path.join(repo, "cache");
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

  server.get("/feed.xml", function (request, response) {
    Step(
      function () {
        loadArticles(this);
      },
      function (err, articles) {
        if (err) return response.simpleText(500, err.stack);
        var parallel = this.parallel;
        var sender = parallel();
        articles.forEach(function (article) {
          compileMarkdown(article.markdown, Path.join("articles", article.name), parallel());
        });
        sender(null, articles);
      },
      function (err, articles) {
        if (err) return response.simpleText(500, err.stack);
        var htmls = Array.prototype.slice.call(arguments, 3);
        articles.forEach(function (article, i) {
          article.content = htmls[i];
        });
        renderTemplate("feed", {articles: articles}, this);
      },
      function (err, xml) {
        if (err) return response.simpleText(500, err.stack);
        response.writeHead(200, {
          "Content-Type": "application/rss+xml",
          "Content-Length": xml.length,
          "Server": "node.js",
          "X-Powered-By": "Wheat",
          "Cache-Control": "public, max-age=86400",
          "Date": (new Date()).toUTCString()
        });
        response.write(xml, "utf8");
        response.end();
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
        compileMarkdown(props.markdown, Path.join("articles", name), this.parallel());
        Git.readFile("description.markdown", this.parallel());
      },
      function (err, html, description) {
        if (err) throw err;
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
    // We're using strong caching on all static files by filename
    // So don't update a file's contents, rename it.
    var etag = MD5.md5(filename);
    var browserEtag = request.headers["if-none-match"];
    if (browserEtag && eCache[browserEtag]) {
      response.writeHead(304, {
        "Content-Type": NodeRouter.mime.getMime(filename),
        "Server": "node.js",
        "X-Powered-By": "Wheat"
      });
      response.end();
      return;
    }

    Git.readFile("skin/public/" + filename, function (err, data) {
      if (err) {
        Git.readFile("articles/" + filename, function (err, data) {
          if (err) { response.notFound(err.message); return; }
          serveFile(data);
        });
        return;
      }
      serveFile(data);
    });
    function serveFile(data) {
      eCache[etag] = true;
      response.writeHead(200, {
        "Content-Type": NodeRouter.mime.getMime(filename),
        "Content-Length": data.length,
        "Server": "node.js",
        "X-Powered-By": "Wheat",
        'Cache-Control': 'public, max-age=32000000',
        "Date": (new Date()).toUTCString(),
        "ETag": etag
      });
      response.write(data, "binary");
      response.end();
    }
  });

  server.listen(port, "0.0.0.0");
};


*/