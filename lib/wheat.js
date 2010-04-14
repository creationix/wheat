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
    MD5 = require('md5'),
    Buffer = require('buffer').Buffer;

var Data;
(function dataSources() {

  function toPlaceholder(path) {
    return "%%" + path + "%%";
  }

  // Extracts the special headers out of an extended markdown document
  function compileMarkdown(version, markdown, callback) {
    var match;
    var props = {};
    Step(
      function parseMarkdown() {
        while(match = markdown.match(/^([a-z]+):\s*(.*)\s*\n/i)) {
          var name = match[1].toLowerCase(),
              value = match[2];
          markdown = markdown.substr(match[0].length);
          props[name] = value;

        }
        var parallel = this.parallel;
        parallel()(null, props);
        parallel()(null, markdown.replace(/\n<[^<>:\s]+\.[a-z]{2,4}>\n/g,
          function (match) {
            var path = match.substr(2, match.length - 4);
            Data.snippet(version, path, parallel());
            return toPlaceholder(path);
          }
        ));
      },
      function insertSnippets(err, props, markdown) {
        if (err) { callback(err); return; }
        Array.prototype.slice.call(arguments, 3).forEach(function (match) {
          sys.p(match);
          markdown = markdown.replace(toPlaceholder(match.path),
            '\n\n<a class="code-link" href="' + match.url + '">' +
              match.name +
            '</a>\n\n' +
            "<pre><code>" + match.code.trim() + "</code></pre>\n"
          );
        });
        props.markdown = markdown;
        props.html = Markdown.encode(markdown);
        return props;
      },
      callback
    )
  }

  // These are our data sources
  Data = {

    // Loads a snippet of code for inclusion in a page
    snippet: Git.safe(function snippet(version, path, callback) {
      Step(
        function () {
          Git.readFile(version, "articles/" + path, this);
        },
        function (err, code) {
          if (err) { callback(err); return; }
          return {
            url: "/" + (version === "fs" ? "" : version + "/") + path,
            name: path.substr(path.lastIndexOf('/') + 1),
            path: path,
            code: code
          }
        },
        callback
      )
    }),

    // Loads the core data for a single article.
    article: Git.safe(function article(version, name, callback) {
      Step(
        function getArticleMarkdown() {
          Git.readFile(version, Path.join("articles", name + ".markdown"), this);
        },
        function getExternals(err, markdown) {
          if (err) { callback(err); return; }
          compileMarkdown(version, markdown, this);
        },
        function (err, props) {
          if (err) { callback(err); return; }
          this.parallel()(null, props);
          Data.author(version, props.author, this.parallel());
        },
        function finish(err, props, author) {
          if (err) { callback(err); return; }
          props.name = name;
          props.author = author;
          return props;
        },
        callback
      );
    }),

    // Loads the core data for a single author.
    author: Git.safe(function author(version, name, callback) {
      Step(
        function getAuthorMarkdown() {
          Git.readFile(version, Path.join("authors", name + ".markdown"), this);
        },
        function parseAndFinish(err, markdown) {
          if (err) { callback(err); return; }
          compileMarkdown(version, markdown, this);
        },
        function finish(err, props) {
          if (err) { callback(err); return; }
          props.name = name;
          return props;
        },
        callback
      );
    }),

    // Loads the core data for all the articles and sorts the list by date.
    articles: Git.safe(function articles(version, callback) {
      Step(
        function getListOfArticles() {
          Git.readDir(version, "articles", this);
        },
        function readArticles(err, results) {
          if (err) { callback(err); return; }
          var parallel = this.parallel;
          results.files.forEach(function onFile(filename) {
            var name = filename.replace(/\.markdown$/, '');
            Data.article(version, name, parallel());
          });
        },
        function sortAndFinish(err) {
          if (err) { callback(err); return; }
          var articles = Array.prototype.slice.call(arguments, 1);
          articles.sort(function dateSorter(a, b) {
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

  // Execute a child process, feed it a buffer and get a new buffer filtered.
  function execPipe(command, args, data, callback) {
    var child = ChildProcess.spawn(command, args);
    var stdout = [], stderr = [], size = 0;
    child.stdout.addListener('data', function onStdout(buffer) {
      size += buffer.length;
      stdout[stdout.length] = buffer;
    });
    child.stderr.addListener('data', function onStderr(buffer) {
      stderr[stderr.length] = buffer;
    });
    child.addListener('exit', function onExit(code) {
      if (code > 0) {
        callback(new Error(stderr.join("")));
      } else {
        var buffer = new Buffer(size);
        var start = 0;
        for (var i = 0, l = stdout.length; i < l; i++) {
          var chunk = stdout[i];
          chunk.copy(buffer, start);
          start += chunk.length;
        }
        callback(null, buffer);
      }
    });
    if (typeof data === 'string') {
      child.stdin.write(data, "binary");
    } else {
      child.stdin.write(data);
    }
    child.stdin.end();
  }

  var Helpers = {
    intro: function intro(markdown) {
      var html = Markdown.encode(markdown);
      return html.substr(0, html.indexOf("<h2"));
    },
    markdownEncode: function markdownEncode(markdown) {
      return Markdown.encode(markdown+"").replace(/\n\n+/g, '');
    },
    github: function github(name) {
      return '<a href="http://github.com/' + name + '">' + name + '</a>';
    },
    bitbucket: function bitbucket(name) {
      return '<a href="http://bitbucket.com/' + name + '">' + name + '</a>';
    },
    twitter: function twitter(name) {
      return '<a href="http://twitter.com/' + name + '">' + name + '</a>';
    },
    gravitar: function gravitar(email, size) {
      size = size || 200
      return "http://www.gravatar.com/avatar/" +
        MD5.md5(email.trim().toLowerCase()) +
        "?r=pg&s=" + size + ".jpg&d=identicon";
    },
    format_date: function format_date(date, format) {
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


  // Convert UTF8 strings to binary buffers for faster loading
  function stringToBuffer(string) {
    var buffer = new Buffer(Buffer.byteLength(string));
    buffer.utf8Write(string);
    return buffer;
  }

  // Loads a haml template and caches in memory.
  var loadTemplate = Git.safe(function loadTemplate(version, name, callback) {
    Step(
      function loadHaml() {
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


  // This writes proper headers for caching and conditional gets
  // Also gzips content if it's text based and stable.
  function postProcess(headers, buffer, version, path, callback) {
    Step(
      function buildHeaders() {
        if (!headers["Content-Type"]) {
          headers["Content-Type"] = "text/html; charset=utf-8";
        }
        var date = new Date().toUTCString();
        headers["Date"] = date;
        headers["Server"] = "Wheat (node.js)";
        if (version === 'fs') {
          delete headers["Cache-Control"];
        } else {
          headers["ETag"] = MD5.md5(version + ":" + path + ":" + date);
        }

        if (/html/.test(headers["Content-Type"])) {
          buffer = stringToBuffer((buffer+"").replace(/<pre><code>[^<]+<\/code><\/pre>/g,
            function applyHighlight(code) {
              var code = code.match(/<code>([\s\S]+)<\/code>/)[1];
              code = Prettify.prettyPrintOne(code)
              return "<pre><code>" + code + "</code></pre>";
            }
          ));
        }

        headers["Content-Length"] = buffer.length;

        // Don't gzip non-text or volatile content.
        if (version === 'fs' ||
            headers["Content-Type"].substr(0, 5) !== "text/") {
          callback(null, {
            headers: headers,
            buffer: buffer
          });
          return;
        }
        execPipe("gzip", ["-9"], buffer, this);
      },
      function addGzipHeaders(err, buffer) {
        if (err) { callback(err); return; }
        headers["Content-Encoding"] = "gzip";
        headers["Vary"] = "Accept-Encoding";
        headers["Content-Length"] = buffer.length;
        return {
          headers: headers,
          buffer: buffer
        };
      },
      callback
    );
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
        function callPostProcess(err, buffer) {
          if (err) { callback(err); return; }
          postProcess({
            "Cache-Control": "public, max-age=3600"
          }, buffer, version, "index", this);
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
        function finish(err, buffer) {
          if (err) { callback(err); return; }
          postProcess({
            "Content-Type":"application/rss+xml",
            "Cache-Control": "public, max-age=3600"
          }, buffer, version, "feed", this);
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
        function finish(err, buffer) {
          if (err) { callback(err); return; }
          postProcess({
            "Cache-Control": "public, max-age=3600"
          }, buffer, version, name, this);
        },
        callback
      );
    }),

    staticFile: Git.safe(function staticFile(version, path, callback) {
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
        function processFile(err, string) {
          if (err) { callback(err); return; }
          var headers = {
            "Content-Type": NodeRouter.mime.getMime(path),
            "Cache-Control": "public, max-age=32000000"
          };
          var buffer = new Buffer(string.length);
          buffer.write(string, 'binary');
          postProcess(headers, buffer, version, path, this);
        },
        callback
      );
    }),

    dotFile: Git.safe(function dotFile(version, path, callback) {
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
          execPipe("dot", ["-Tpng"], data, this);
        },
        function finish(err, buffer) {
          if (err) { callback(err); return; }
          postProcess({
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=32000000"
          }, buffer, version, path, this);
        },
        callback
      );
    })
  }

}());

var Wheat = module.exports = function Wheat(repo, port, host) {
  Git(repo); // Connect to the git repo

  var server = NodeRouter.getServer();

  function addRoute(matcher, renderer) {
    server.get(matcher, function requestHandler(request, response) {
      var args = Array.prototype.slice.call(arguments, 2);
      args.push(function responder(err, result) {
        if (err) {
          if (!(err instanceof Error)) {
            err = new Error(sys.inspect(err));
          }
          response.simpleText(500, err.stack);
          return;
        }
        var etag = request.headers["if-none-match"];
        if (etag && etag === result.headers["ETag"]) {
          response.writeHead(304, {
            "Date": result.headers["Date"],
            "Server": result.headers["Server"],
            "Cache-Control": result.headers["Cache-Control"],
            "ETag": result.headers["ETag"]
          });
          response.end();
          return;
        }
        response.writeHead(200, result.headers);
        response.end(result.buffer);
      });
      if (args[0] === '') {
        Git.getHead(function onKnownSha(err, sha) {
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
  addRoute(/^\/([a-f0-9]{40})\/([a-z0-9_-]+)$/, Renderers.article);
  addRoute(/^\/([a-f0-9]{40})\/(.+\.dot)$/, Renderers.dotFile);
  addRoute(/^\/([a-f0-9]{40})\/(.+\.[a-z]{2,4})$/, Renderers.staticFile);
  addRoute(/^\/()([a-z0-9_-]+)$/, Renderers.article);
  addRoute(/^\/()(.+\.dot)$/, Renderers.dotFile);
  addRoute(/^\/()(.+\.[a-z]{2,4})$/, Renderers.staticFile);

  server.listen(port, host);
};
