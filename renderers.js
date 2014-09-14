"use strict";
var makePathToEntry = require('repo-farm/node-vfs');
var modes = require('js-git/lib/modes');
var getMime = require('simple-mime')();
var run = require('gen-run');
var crypto = require('crypto');
var datetime = require('datetime');
var hamlCompile = require('haml');
var markdownEncoder = require('./markdown');
var prettify = require('./prettify');
var spawn = require('child_process').spawn;

module.exports = wheatMiddleware;

function wheatMiddleware(gitUrl, gitRef, cacheDir) {
  gitUrl = gitUrl || "git://github.com/creationix/howtonode.org.git";
  gitRef = gitRef || "refs/heads/master";
  cacheDir = cacheDir || __dirname + "/git-cache";

  var pathToEntries = {};

  var routes = [
    /^\/$/, renderIndex,
    /^\/feed.xml$/, renderFeed,
    /^\/([a-z0-9_-]+)$/, renderArticle,
    /^\/(.+\.dot)$/, renderDotFile,
    /^\/(.+\.[a-z]{2,4})$/, renderStaticFile,
    /^\/category\/([\%\.a-z0-9_-]+)$/, renderCategoryIndex,
  ];

  return function* () {

    // Any path prefixed with a 20-byte hex hash hard-codes the git sha1 for the commit
    // Also allows refs/heads/* and refs/tags/* and refs/current symbolic refs.
    // This allows reading any version of the site in past history.
    var path = this.path;
    var ref = path.match(/^\/([a-f0-9]{40}|refs\/current|refs\/(?:heads|tags)\/[^\/]+)(\/.*)$/);
    if (ref) {
      path = ref[2];
      ref = ref[1];
    }
    else {
      ref = gitRef;
    }

    // Loop through the routes finding the first match (if any)
    var renderer, match;
    for (var i = 0; i < routes.length; i += 2) {
      match = path.match(routes[i]);
      if (!match) continue;
      renderer = routes[i + 1];
      break;
    }
    if (!renderer) return;

    // Make sure we have a repo-farm instance for this ref
    this.pathToEntry = pathToEntries[ref] ||
      (pathToEntries[ref] = makePathToEntry(gitUrl, ref, cacheDir).next().value);
    var args = [].slice.call(match, 1);

    // Run the renderer using gen-run instead of co.
    // Yield a thunk so we can adapt between co and gen-run.
    var self = this;
    yield function (callback) {
      run(renderer.apply(self, args), callback);
    };

    if (typeof this.body === "string") {
      this.body = new Buffer(this.body.replace(/<pre><code>[^<]+<\/code><\/pre>/g, function (code) {
        code = code.match(/<code>([\s\S]+)<\/code>/)[1];
        code = prettify.prettyPrintOne(code);
        return "<pre><code>" + code + "</code></pre>";
      }));
    }
  };

}

function* renderIndex() {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("articles");
  if (!meta || !meta.mode) return;
  var tree = yield meta.repo.loadAs("array", meta.hash);
  var articles = [];
  for (var i = 0; i < tree.length; ++i) {
    var entry = tree[i];
    if (!modes.isFile(entry.mode)) continue;
    var match = entry.name.match(/^(.+)\.markdown$/);
    if (!match) continue;
    meta = yield* this.pathToEntry("articles/" + entry.name);
    var markdown = yield meta.repo.loadAs("text", meta.hash);
    var article = preProcessMarkdown(markdown);

    meta = yield* this.pathToEntry("authors/" + article.author + ".markdown");
    markdown = yield meta.repo.loadAs("text", meta.hash);
    var author = preProcessMarkdown(markdown);
    author.name = article.author;
    article.author = author;
    article.name = match[1];
    articles.push(article);
  }

  articles.sort(function (a, b) {
    var ad = new Date(a.date);
    var bd = new Date(b.date);
    return ad < bd ? 1 : bd < ad ? -1 : 0;
  });

  var description = "";
  meta = yield* this.pathToEntry("description.markdown");
  if (meta && modes.isFile(meta.mode)) {
    description = yield meta.repo.loadAs("text", meta.hash);
  }

  yield* render.call(this, "index", {
    articles: articles,
    description: description,
  });

  // this.body = "TODO: render index\n";
}

function* renderFeed() {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("/");
  if (!meta || !meta.mode) return;
  this.body = "TODO: render feed\n";
}

function* renderArticle(name) {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("articles/" + name + ".markdown");
  if (!meta || !meta.mode) return;
  var markdown = yield meta.repo.loadAs("text", meta.hash);
  var article = preProcessMarkdown(markdown);
  console.log(article);

  meta = yield* this.pathToEntry("authors/" + article.author + ".markdown");
  markdown = yield meta.repo.loadAs("text", meta.hash);
  var author = preProcessMarkdown(markdown);
  author.name = article.author;
  article.author = author;
  console.log(author);

  var snippets = article.snippets;

  var snippetTemplate = yield* loadTemplate.call(this, "snippet");

  for (var i = 0; i < snippets.length; i++) {
    var snippet = snippets[i];
    meta = yield* this.pathToEntry("articles/" + snippet.filename);
    if (!meta || !meta.mode) continue;
    var code = yield meta.repo.loadAs("text", meta.hash);
    if (snippet.name) {
      var regex = new RegExp("^//" + snippet.name + "\n((?:[^/]|/[^/]|//[^a-z])*)", "m");
      var match = code.match(regex);
      snippet.beforeCode = code.substr(0, match.index);
      snippet.code = match[1];
    }
    else {
      snippet.code = code.replace(/^\/\/[a-z-]+.*\n/mg, '');
    }
    snippet.code = snippet.code.trim();
    var html = snippetTemplate({snippet: snippet});

    var old = article.markdown;
    article.markdown = article.markdown.replace(snippet.original, html);
    if (old === article.markdown) {
      throw new Error("insert failed");
    }
  }

  var description = "";
  meta = yield* this.pathToEntry("description.markdown");
  if (meta && modes.isFile(meta.mode)) {
    description = yield meta.repo.loadAs("text", meta.hash);
  }

  yield* render.call(this, "article", {
    article: article,
    author: author,
    title: article.title,
    description: description,
  });
}

// Render static content from the skins/public folder in the git repo.
function* renderStaticFile(path) {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("skin/public/" + path);
  if (!meta || !modes.isFile(meta.mode)) return;
  this.body = yield meta.repo.loadAs("blob", meta.hash);
  this.type = getMime(this.path);
}

function* renderDotFile(name) {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("/articles/" + name);
  if (!meta || !meta.mode) return;
  var dot = yield meta.repo.loadAs("blob", meta.hash);
  this.body = yield function (callback) {
    var done = false;
    var child = spawn("dot", ["-Tpng"]);
    child.stdin.write(dot);
    child.stdin.end();
    var stdout = [];
    var stderr = [];
    var code, signal;
    child.stdout.on('data', function (chunk) {
      stdout.push(chunk);
    });
    child.stdout.on('end', function () {
      callback(null, Buffer.concat(stdout));
      check();
    });
    child.stderr.on("data", function (chunk) {
      stderr.push(chunk);
    });
    child.stderr.on("end", function () {
      stderr = Buffer.concat(stderr);
      check();
    });
    child.on("error", function (err) {
      if (done) return;
      done = true;
      if (err.code === "ENOENT") err = new Error("Graphviz dot not installed");
      callback(err);
    });
    child.on("exit", function (c, s) {
      code = c;
      signal = s;
      check();
    });
    function check() {
      if (done) return;
      if (Array.isArray(stdout) || Array.isArray(stderr) || code === undefined) return;
      done = true;
      if (code) callback(new Error(stderr + stdout));
      callback(null, stdout);
    }
  };
  this.type = "image/png";
}

function* renderCategoryIndex(name) {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("/");
  if (!meta || !meta.mode) return;
  this.body = "TODO: render category index\n";
}

function* render(name, data) {
  /*jshint validthis:true*/
  var layout = yield* loadTemplate.call(this, "layout");
  var template = yield* loadTemplate.call(this, name);
  this.body = layout({
    content: template(data),
    title: data.title || ""
  });
}

function* loadTemplate(name) {
  /*jshint validthis:true*/
  var meta = yield* this.pathToEntry("skin/" + name + ".haml");
  if (!meta || !meta.mode) return;
  var haml = yield meta.repo.loadAs("text", meta.hash);
  var raw = hamlCompile(haml + "", (/\.xml$/).test(name));
  return function (data) {
    data.__proto__ = helpers;
    return raw.call(this, data);
  };
}

var helpers = {
  intro: function intro(markdown) {
    var html = markdownEncoder.encode(markdown);
    return html.substr(0, html.indexOf("<h2"));
  },
  markdownEncode: function markdownEncode(markdown) {
    return markdownEncoder.encode(markdown+"");
  },
  github: function github(name) {
    return '<a href="https://github.com/' + name + '">' + name + '</a>';
  },
  bitbucket: function bitbucket(name) {
    return '<a href="https://bitbucket.com/' + name + '">' + name + '</a>';
  },
  twitter: function twitter(name) {
    return '<a href="https://twitter.com/' + name + '">' + name + '</a>';
  },
  gravitar: function gravitar(email, size) {
    size = size || 200;
    var hash = crypto.createHash('md5');
    hash.update((email + "").trim().toLowerCase());
    return "http://www.gravatar.com/avatar/" +
      hash.digest('hex') +
      "?r=pg&s=" + size + ".jpg&d=identicon";
  },
  formatDate: function formatDate(val, format, tz, locale) {
    return datetime.format(new Date(val), format, tz, locale);
  },
  formatRFC822Date: function formatRFC822Date(val) {
    return datetime.format(new Date(val), "%a, %d %b %Y %H:%M:%S %z");
  }
};

function preProcessMarkdown(markdown) {
  if (typeof markdown !== 'string') {
    markdown = markdown.toString();
  }
  var props = { };

  // Parse out headers
  var match;
  while((match = markdown.match(/^([a-z]+):\s*(.*)\s*\n/i))) {
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
      var execute = path[path.length - 1] === "*";
      if (execute) {
        filename = filename.substr(0, filename.length - 1);
      }
      var base = path.substr(path.indexOf('/') + 1).replace(/[#*].*$/, '');
      var match = filename.match(/#(.+)$/);
      var name;
      if (match) {
        name = match[1];
        filename = path.substr(0, match.index);
      }
      return (unique[base] = {
        original: original,
        filename: filename,
        execute: execute,
        base: base,
        name: name
      });
    }
  );
  if (props.snippets.length === 0) {
    props.uniqueSnippets = false;
  }


  return props;
}
