var Git = require('git-fs'),
    Path = require('path'),
    Step = require('step'),
    util = require(process.binding('natives').util ? 'util' : 'sys'),
    Script = require('vm'),
    QueryString = require('querystring');

function preProcessMarkdown(markdown) {
  if (!(typeof markdown === 'string')) {
    markdown = markdown.toString();
  }
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
  props.snippets = (markdown.match(/(\r\n|\n)<[^<>:\s]+\.[a-z]{2,4}(\*|[#].+)?>(\r\n|\n)/g) || []).map(
    function (original) {
      var path = original.slice(original.indexOf("<")+1, original.indexOf(">"));
      
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
  snippet.output = "";
  function fakeRequire(path) {
    var lib = require(path);
    return lib;
  }
  // Create a 'pseudo-write-stream', to act as the virtual 'stdout' stream.
  var stdout = new (require('stream').Stream)();
  stdout.writable = true;
  stdout.write = function(buf, enc) {
    if (!this.writable) throw new Error("Stream is not writable");
    if (!Buffer.isBuffer(buf)) {
      buf = new Buffer(buf, enc);
    }
    this.emit('data', buf);
  }
  stdout.end = function(buf, enc) {
    if (buf) { this.write(buf, enc); }
    this.writable = false;
  }
  stdout.on('data', function(data) {
    snippet.output += data.toString();
  });
  
  var env = {
    clear: function () { snippet.output = ""; },
    require: fakeRequire,
    process: {
      exit: function fakeExit() {},
      argv: [process.argv[0], snippet.filename],
      stdout: stdout
    },
    console: {
      log: function fakeLog() {
        arguments.forEach(function (data) {
          stdout.write(data + "\n");
        });
      },
      dir: function fakeDir() {
        arguments.forEach(function (data) {
          snippet.output += util.inspect(data) + "\n";
        });
      }
    }
  };
  env.process.__proto__ = process;

  var toRun = (snippet.beforeCode ? (snippet.beforeCode + "\nclear();\n") : "") + snippet.code;
  //console.log(toRun);

  try {
    snippet.lastExpression = Script.runInNewContext(toRun, env, snippet.filename);
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
      var group = this.group();
      snippets.forEach(function (snippet) {
        Git.readFile(version, "articles/" + snippet.filename, group());
      });
    },
    function (err, files) {
      if (err) { callback(err); return; }
      files.forEach(function (code, i) {
        code = code + "";
        var snippet = snippets[i];

        if (snippet.name) {
          var regex = new RegExp("^//" + snippet.name + "\n((?:[^/]|/[^/]|//[^a-z])*)", "m");
          var match = code.match(regex);
          snippet.beforeCode = code.substr(0, match.index);
          snippet.code = match[1];
        } else {
          snippet.code = code.replace(/^\/\/[a-z-]+.*\n/mg, '');
        }
        snippet.code = snippet.code.trim();
        if (canExecute && snippet.execute) {
          sandbox(snippet);
        }
      });
      return snippets;
    },
    callback
  );
}

// These are our data sources
var Data = module.exports = {

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
        Git.readFile(version, "articles/" + name + ".markdown", this);
      },
      function (err, markdown) {
        if (err) { callback(err); return; }
        props = preProcessMarkdown(markdown);
        if (props.author) {
          Data.author(version, props.author, this);
        } else {
          return {};
        }
      },
      function finish(err, author) {
        if (err) { callback(err); return; }
        props.name = name;
        if (version !== 'fs') {
          props.version = version;
        }
        props.author = author;

        if(props.categories != undefined){
          props.categories = props.categories.split(',').map(function(element){ 
            return QueryString.escape(element.trim());
          });
        }
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
        if (Object.keys(log).length > 0) {
          article.lastUpdated = log[Object.keys(log)[0]].date;
        }

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
        if (!name) {
          callback(new Error("name is required"));
          return;
        }
        Git.readFile(version, "authors/" + name + ".markdown", this);
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

  categories: Git.safe(function articles(version, callback) {
    Step(
      function getListOfArticles() {
        Git.readDir(version, "articles", this);
      },
      function readArticles(err, results) {
        if (err) { callback(err); return; }
        var group = this.group();
        results.files.forEach(function onFile(filename) {
          if (!(/\.markdown$/.test(filename))) {
            return;
          }
          var name = filename.replace(/\.markdown$/, '');
          Data.article(version, name, group());
        });
      },
      function processCategories(err, articles) {
        if (err) { callback(err); return; }
        var categories = articles.reduce(function (start, element) {
          if (element && element.categories) {
            element.categories.forEach(function(category) {
              if(start.indexOf(category) == -1) {
                start = start.concat(category);
              }
            });
          }
          return start;
        }, []);
        return categories;
      },
      callback
    )
  }),

  fullArticles: Git.safe(function fullArticles(version, callback) {
    Step(
      function getListOfArticles() {
        Git.readDir(version, "articles", this);
      },
      function readArticles(err, results) {
        if (err) { callback(err); return; }
        var group = this.group();
        results.files.forEach(function onFile(filename, i) {
          if (!(/\.markdown$/.test(filename))) {
            return;
          }
          var name = filename.replace(/\.markdown$/, '');
          var cb = group();
          Data.fullArticle(version, name, function () {
            return cb.apply(this, arguments);
          });
        });
      },
      function sortAndFinish(err, articles) {

        if (err) { callback(err); return; }
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
        var group = this.group();
        results.files.forEach(function onFile(filename) {
          if (!(/\.markdown$/.test(filename))) {
            return;
          }
          var name = filename.replace(/\.markdown$/, '');
          Data.article(version, name, group());
        });
      },
      function sortAndFinish(err, articles) {
        if (err) { callback(err); return; }
        articles.sort(function dateSorter(a, b) {
          return (Date.parse(b.date)) - (Date.parse(a.date));
        });
        return articles;
      },
      callback
    )
  })

};

