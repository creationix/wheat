/*
Copyright (c) 2010 Tim Caswell <tim@creationix.com>

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
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
    Graphviz = require('graphviz');

var templateCache = {};
var articleCache = {};
var authorCache = {};
var authorsCache;

function clearCache() {
  templateCache = {};
  articleCache = {};
  authorCache = {};
  authorsCache = undefined;
  Git.clearCache();
}

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

// Executes a template.  Loading and caching it if needed.
function renderTemplate(name, data, callback) {
  // Data is optional
  if (typeof data === 'function' && typeof callback === 'undefined') {
    callback = data;
    data = {};
  }
  data.__proto__ = Helpers;
  if (name in templateCache) {
    callback(null, templateCache[name](data));
    return;
  }
  Git.readFile("skin/" + name + ".haml", function (err, haml) {
    if (err) {
      callback(err);
      return;
    }
    templateCache[name] = Haml(haml);
    callback(null, templateCache[name](data));
  });
}

function renderDot(path, callback) {
  Git.readFile("articles/" + path, function (err, data) {
    if (err) {
      callback(err);
      return;
    }
    Graphviz(data, callback);
  });
}

function loadArticle(name, callback) {
  if (name in articleCache) return callback(null, articleCache[name]);
  var props;
  Step(
    function () {
      Git.readFile(path.join("articles", name + ".markdown"), this);
    },
    function (err, markdown) {
      if (err) return callback(err);
      props = markdownPreParse(markdown);
      props.name = name;
      loadAuthor(props.author, this);
    },
    function (err, author) {
      props.author = author;
      sys.p(props);
      articleCache[name] = props 
      callback(null, articleCache[name]);
    }
  );
}

function loadAuthor(name, callback) {
  if (name in authorCache) return callback(null, authorCache[name]);
  Git.readFile(path.join("authors", name + ".markdown"), function (err, markdown) {
    if (err) return callback(err);
    var props = markdownPreParse(markdown);
    props.name = name;
    authorCache[name] = props;
    callback(null, authorCache[name]);
  });
}

// Reads the authors in the authors directory and returns a data structure
function loadAuthors(callback) {
  if (authorsCache) return callback(null, authorsCache);
  var names;
  Step(
    function getFileNames() {
      Git.readDir("authors", this);
    },
    function readFileContents(err, results) {
      if (err) return callback(err);
      var parallel = this.parallel;
      results.files.forEach(function (filename) {
        var name = filename.replace(/\.markdown$/, '');
        loadAuthor(name, parallel());
      });
    },
    function parseFileContents(err) {
      if (err) return callback(err);
      var authors = {};
      Array.prototype.slice.call(arguments, 1).forEach(function (author) {
        authors[author.name] = author;
      });
      authorsCache = authors;
      callback(null, authorsCache);
    }
  );
}

// Generic page renderer with layout
function render(request, response, data) {
  renderTemplate("layout", data, function(err, html) {
    if (err) {
      response.simpleText(500, err.stack);
      return;
    }
    response.simpleHtml(200, html);
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
  github: function (name) {
    return "http://github.com/" + name;
  },
  gravitar: function (email, size) {
    size = size || 80
    return "http://www.gravatar.com/avatar/" +
      md5(email.trim().toLowerCase()) +
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

var Wheat = module.exports = function (repo, port) {
  Git(repo); // Connect to the git repo
  var server = NodeRouter.getServer();
  
  // Renders an overview page
  server.get("/", function (request, response) {
    clearCache(); // TODO: remove when done
    
    Step(
      function loadData() {
        Git.getTags(this.parallel());
        loadAuthors(this.parallel());
      },
      function renderContent(err, tags, authors) {
        if (err) return response.simpleText(500, err.stack);
        var data = {
          tags: tags.map(function (sha, tag) {
            return {
              name: tag,
              sha: sha,
              href: "/versions/" + sha
            };
          }),
          authors: authors.map(function (props, name) {
            props.name = name;
            return props;
          })
        };
        data.tags.unshift({name:"HEAD", href:"/"});
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
      response.close();
    });
  });
  
  server.get(/^\/([a-z-]+)$/, function (request, response, name) {
    clearCache(); // TODO: remove when done
    var props;
    Step(
      function () {
        loadArticle(name, this);
      },
      function (err, article) {
        if (err) return response.simpleText(500, err.stack);
        props = article;
        compileMarkdown(props.markdown, path.join("articles", name), this);
      },
      function (err, html) {
        if (err) return response.simpleText(500, err.stack);
        html = html.replace(/<pre><code>[^<]+<\/code><\/pre>/g, function (code) {
          var code = code.match(/<code>([\s\S]+)<\/code>/)[1];
          code = Prettify.prettyPrintOne(code)
          return "<pre><code>" + code + "</code></pre>";
        });
        props.content = html;
        props.full = true;
        renderTemplate("_article", props, this);
      },
      function (err, content) {
        render(request, response, {
          title: props.title,
          content: content
        });
      }
    )
  });
  // Load static files from the "skin/public/" folder of the git repo.
  server.get(/^\/(.*\.[a-z]{2,4})$/, function (request, response, filename) {
    clearCache(); // TODO: remove when done
    var type = NodeRouter.mime.getMime(filename);
    var encoding = (type.substr(0,4) === "text" ? "utf8" : "binary");
    Git.readFile("skin/public/" + filename, function (err, content) {
      if (err) {
        Git.readFile("articles/" + filename, function (err, content) {
          if (err) {
            response.notFound();
            return;
          }
          response.writeHead(200, {
            "Content-Type": type,
            "Content-Length": content.length
          });
          response.write(content, 'binary');
          response.close();
        });
        return;
      }
      response.writeHead(200, {
        "Content-Type": type,
        "Content-Length": content.length
      });
      response.write(content, 'binary');
      response.close();
    });
  });

  server.listen(port);
};

