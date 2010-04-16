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

var render;
var compileTemplate;
var stringToBuffer;
(function tools() {

  function pad(num) {
    return num < 10 ? "0" + num : num;
  }

  // accepts the client's time zone offset from GMT in minutes as a parameter.
  // returns the timezone offset in the format [+|-}DDDD
  function getTZOString(timezoneOffset)
  {
    var hours = Math.floor(timezoneOffset / 60);
    var modMin = Math.abs(timezoneOffset % 60);
    var s = new String();
    s += (hours > 0) ? "-" : "+";
    var absHours = Math.abs(hours)
    s += (absHours < 10) ? "0" + absHours :absHours;
    s += ((modMin == 0) ? "00" : modMin);
    return(s);
  }

  var daysInWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "Saturday", "Sunday"];
  var monthsInYear = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var aMonths = new Array("Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");
  var aDays = new Array( "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat");

  var Helpers = {
    inspect: sys.inspect,
    intro: function intro(markdown) {
      var html = Markdown.encode(markdown);
      return html.substr(0, html.indexOf("<h2"));
    },
    markdownEncode: function markdownEncode(markdown) {
      return Markdown.encode(markdown+"");
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
      size = size || 200;
      return "http://www.gravatar.com/avatar/" +
        MD5.md5(email.trim().toLowerCase()) +
        "?r=pg&s=" + size + ".jpg&d=identicon";
    },
    formatDate: function formatDate(val, format) {
      var date = new Date(val),
          match, value;
      while (match = format.match(/(%[a-z])/i)) {
        switch (match[1]) {
          case "%Y": // A full numeric representation of a year, 4 digits
            value = date.getFullYear(); break;
          case "%m": // Numeric representation of a month, with leading zeros
            value = pad(date.getMonth() + 1); break;
          case "%F": // A full textual representation of a month like March
            value = monthsInYear[date.getMonth()]; break;
          case "%d": // Day of the month, 2 digits with leading zeros
            value = pad(date.getDate() + 1); break;
          case "%j": // Day of the month without leading zeros
            value = pad(date.getDate() + 1); break;
          case "%l": // A full textual representation of the day of the week
            value = daysInWeek[date.getDay()]; break;
          case "%H": // 24-hour format of an hour with leading zeros
            value = pad(date.getHours()); break;
          case "%i": // Minutes with leading zeros
            value = pad(date.getMinutes()); break;
          case "%s": // Seconds, with leading zeros
            value = pad(date.getSeconds()); break;
          default:
            value = ""; break;
        }
        format = format.replace(match[1], value);
      }
      return format;
    },
    formatRFC822Date: function formatRFC822Date(val)
    {
      var oDate = new Date(val);
      var dtm = new String();

      dtm = aDays[oDate.getDay()] + ", ";
      dtm += pad(oDate.getDate()) + " ";
      dtm += aMonths[oDate.getMonth()] + " ";
      dtm += oDate.getFullYear() + " ";
      dtm += pad(oDate.getHours()) + ":";
      dtm += pad(oDate.getMinutes()) + ":";
      dtm += pad(oDate.getSeconds()) + " " ;
      dtm += getTZOString(oDate.getTimezoneOffset());
      return dtm;
    }

  };

  // Convert UTF8 strings to binary buffers for faster loading
  stringToBuffer = function stringToBuffer(string) {
    var buffer = new Buffer(Buffer.byteLength(string));
    buffer.utf8Write(string);
    return buffer;
  };

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

  // Like loadTemplate, but doesn't require the version
  compileTemplate = function compileTemplate(name, callback) {
    Step(
      function getHead() {
        Git.getHead(this);
      },
      function loadTemplates(err, version) {
        if (err) { callback(err); return; }
        loadTemplate(version, name, this);
      },
      function (err, template) {
        if (err) { callback(err); return; }
        return function (data) {
          data.__proto__ = Helpers;
          return template.apply(this, arguments);
        };
      },
      callback
    );
  };

  render = function render(name, data, callback, partial) {
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
}());

var Data;
(function dataSources() {

  function preProcessMarkdown(markdown) {
    var props = { };

    // Parse out headers
    var match;
    while(match = markdown.match(/^([a-z]+):\s*(.*)\s*\n/i)) {
      var name = match[1].toLowerCase(),
          value = match[2];
      markdown = markdown.substr(match[0].length);
      props[name] = value;
    }
    props.markdown = markdown;

    // Look for snippet placeholders
    var unique = props.uniqueSnippets = {};
    props.snippets = (markdown.match(/\n<[^<>:\s]+\.[a-z]{2,4}(\*|[#].+)?>\n/g) || []).map(
      function (original) {
        var path = original.substr(2, original.length - 4);

        var filename = path;
        execute = path[path.length - 1] === "*";
        if (execute) {
          filename = filename.substr(0, filename.length - 1);
        }
        base = path.substr(path.indexOf('/') + 1).replace(/[#*].*$/, '');
        var match = filename.match(/#(.+)$/);
        var name;
        if (match) {
          name = match[1];
          filename = path.substr(0, match.index);
        }
        return unique[base] = {
          original: original,
          filename: filename,
          execute: execute,
          base: base,
          name: name
        };
      }
    );
    if (props.snippets.length === 0) {
      props.uniqueSnippets = false;
    }


    return props;
  }

  function sandbox(snippet) {
    snippet.result = "";
    var overrides = {
      sys: {
        puts: function fakePuts() {
          arguments.forEach(function (data) {
            snippet.output += data + "\n";
          });
        },
        p: function fakeP(data) {
          arguments.forEach(function (data) {
            snippet.output += sys.inspect(data) + "\n";
          });
        }
      },
    }
    var fakeRequire = function fakeRequire(path) {
      var lib = require(path);
      if (overrides[path]) {
        lib.mixin(overrides[path]);
      }
      return lib;
    };
    var env = {
      clear: function () { snippet.output = ""; },
      require: fakeRequire,
      process: {
        exit: function fakeExit() {},
        argv: ['node', snippet.filename]
      }
    };
    env.process.__proto__ = process;

    var toRun = (snippet.beforeCode ? (snippet.beforeCode + "\nclear();\n") : "") + snippet.code;

    // Ignore shebang line
    if (toRun.substr(0,3) == "#!/") {
      toRun = toRun.substr(toRun.indexOf("\n"));
    }

    try {
      snippet.lastExpression = process.evalcx(toRun, env, snippet.filename);
    } catch (err) {
      snippet.error = err;
    }
  }

  function activateSnippets(version, snippets, canExecute, callback) {
    Step (
      function () {
        if (snippets.length === 0) {
          callback(null, snippets);
          return;
        }
        var parallel = this.parallel;
        snippets.forEach(function (snippet) {
          Git.readFile(version, "articles/" + snippet.filename, parallel());
        });
      },
      function (err) {
        if (err) { callback(err); return; }
        Array.prototype.slice.call(arguments, 1).forEach(function (code, i) {
          var snippet = snippets[i];

          if (snippet.name) {
            var regex = new RegExp("^//" + snippet.name + "\n((?:[^/]|/[^/]|//[^a-z])*)", "m");
            var match = code.match(regex);
            snippet.beforeCode = code.substr(0, match.index);
            snippet.code = match[1];
          } else {
            snippet.code = code.replace(/^\/\/[a-z-]+.*\n/mg, '');
          }
          if (canExecute && snippet.execute) {
            sandbox(snippet);
          }
        });
        return snippets;
      },
      callback
    );
  }

  // // Extracts the special headers out of an extended markdown document
  // function compileMarkdown(version, markdown, callback) {
  //   var props = {};
  //   Step(
  //     function parseMarkdown() {
  //       var parallel = this.parallel;
  //
  //       compileTemplate("snippet", parallel());
  //       parallel()(null, markdown.replace(/\n<[^<>:\s]+\.[a-z]{2,4}(\*|[#].+)?>\n/g,
  //         function (match) {
  //           var path = match.substr(2, match.length - 4);
  //           Data.snippet.call(props.node, version, path, parallel());
  //           return toPlaceholder(path);
  //         }
  //       ));
  //     },
  //     function insertSnippets(err, template, markdown) {
  //       if (err) { callback(err); return; }
  //       Array.prototype.slice.call(arguments, 4).forEach(function (match) {
  //         markdown = markdown.replace(toPlaceholder(match.path),
  //           "\n"+template({snippet:match})+"\n"
  //         );
  //       });
  //       props.markdown = markdown;
  //       props.html = Markdown.encode(markdown);
  //       return props;
  //     },
  //     callback
  //   )
  // }


  // These are our data sources
  Data = {

    // Loads a snippet of code for inclusion in a page
    snippet: Git.safe(function snippet(version, path, callback) {
      var name, filename, execute, base, url, beforeCode, result;
      function error(err) {
        callback(null, {
          url: url,
          name: name,
          base: base,
          execute: execute,
          path: path,
          code: err.stack,
          error: err.message
        });
      }
      Step(
        function () {
          filename = path;
          execute = path[path.length - 1] === "*";
          if (execute) {
            filename = filename.substr(0, filename.length - 1);
          }
          base = path.substr(path.indexOf('/') + 1).replace(/[#*].*$/, '');
          var match = filename.match(/#(.+)$/);
          if (match) {
            name = match[1];
            filename = path.substr(0, match.index);
          }
          url = "/" + (version === "fs" ? "" : version + "/") + filename;
          Git.readFile(version, "articles/" + filename, this);
        },
        function (err, code) {
          if (err) { error(err); return; }
          result = {
            url: url,
            name: name,
            base: base,
            execute: execute,
            path: path,
            beforeCode: beforeCode,
            code: code.trim(),
            output: ""
          };
        },
        function (err, result) {
          if (err) { error(err); return; }
          callback(null, result);
        }
      )
    }),

    // Loads the core data for a single article.
    article: Git.safe(function article(version, name, callback) {
      var props;
      Step(
        function getArticleMarkdown() {
          Git.readFile(version, Path.join("articles", name + ".markdown"), this);
        },
        function (err, markdown) {
          if (err) { callback(err); return; }
          props = preProcessMarkdown(markdown);
          Data.author(version, props.author, this.parallel());
        },
        function finish(err, author) {
          if (err) { callback(err); return; }
          props.name = name;
          if (version !== 'fs') {
            props.version = version;
          }
          props.author = author;
          return props;
        },
        callback
      );
    }),

    // Loads a full article complete with log information and executed
    // snippets.
    fullArticle: Git.safe(function fullArticle(version, name, callback) {
      var article;
      Step(
        function getBase() {
          Data.article(version, name, this);
        },
        function loadExtras(err, props) {
          if (err) { callback(err); return; }
          article = props;
          Data.articles(version, this.parallel());
          Git.log("articles/" + name + ".markdown", this.parallel());
          var canExecute = article.node && ("v" + process.version).indexOf(article.node) >= 0
          canExecute = true;
          activateSnippets(version, article.snippets, canExecute, this.parallel());
        },
        function finish(err, articles, log, snippets) {
          
          if (err) { callback(err); return; }
          article.log = log;
          article.snippets = snippets;
          article.lastUpdated = log[Object.keys(log)[0]].date;

          // Find articles with the same author
          var related = article.related = [];
          articles.forEach(function (otherArticle) {
            if (otherArticle.author.name === article.author.name &&
                otherArticle.name !== article.name) {
              related.push(otherArticle);
            };
          });
          return article
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
        function process(err, markdown) {
          if (err) { callback(err); return; }
          return preProcessMarkdown(markdown);
        },
        function finish(err, props) {
          if (err) { callback(err); return; }
          props.name = name;
          return props;
        },
        callback
      );
    }),
    
    fullArticles: Git.safe(function fullArticles(version, callback) {
      Step(
        function getListOfArticles() {
          Git.readDir(version, "articles", this);
        },
        function readArticles(err, results) {
          if (err) { callback(err); return; }
          var parallel = this.parallel;
          results.files.forEach(function onFile(filename, i) {
            var name = filename.replace(/\.markdown$/, '');
            var cb = parallel();
            Data.fullArticle(version, name, function () {
              return cb.apply(this, arguments);
            });
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

  function insertSnippets(markdown, snippets, callback) {
    Step(
      function () {
        compileTemplate('snippet', this);
      },
      function (err, snippetTemplate) {
        if (err) { callback(err); return; }
        snippets.forEach(function (snippet) {
          var html = snippetTemplate({snippet: snippet});
          markdown = markdown.replace(snippet.original, html);
        });
        return markdown;
      },
      callback
    )
  }

  Renderers = {
    index: Git.safe(function index(version, callback) {
      Step(
        function getHead() {
          Git.getHead(this);
        },
        function loadData(err, head) {
          if (err) { callback(err); return; }
          Data.articles(version, this.parallel());
          Git.readFile(head, "description.markdown", this.parallel());
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
      var articles;
      Step(
        function loadData() {
          Data.fullArticles(version, this);
        },
        function (err, data) {
          if (err) { callback(err); return; }
          articles = data;
          var parallel = this.parallel;
          articles.forEach(function (article) {
            insertSnippets(article.markdown, article.snippets, parallel());
          });
        },
        function applyTemplate(err) {
          if (err) { callback(err); return; }
          Array.prototype.slice.call(arguments, 1).forEach(function (markdown, i) {
            articles[i].markdown = markdown;
          });
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

    article: Git.safe(function renderArticle(version, name, callback) {
      var article, description;
      Step(
        function loadData() {
          Git.getHead(this.parallel());
          Data.fullArticle(version, name, this.parallel());
        },
        function (err, head, props) {
          if (err) { callback(err); return; }
          article = props;
          insertSnippets(article.markdown, article.snippets, this.parallel());
          Git.readFile(head, "description.markdown", this.parallel());
        },
        function applyTemplate(err, markdown, description) {
          if (err) { callback(err); return; }
          article.markdown = markdown;
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
