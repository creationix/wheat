require('proto');
var ChildProcess = require('child_process'),
    path = require('path'),
    sys = require('sys'),
    fs = require('fs'),
    Git = require('./git'),
    Haml = require('haml'),
    markdown = require('markdown'),
    Step = require('./step'),
    NodeRouter = require('node-router');

var templateCache = {};

function clearCache() {
  templateCache = {};
  Git.clearCache();
}

// Executes a template.  Loading and caching it if needed.
function renderTemplate(name, data, callback) {
  // Data is optional
  if (typeof data === 'function' && typeof callback === 'undefined') {
    callback = data;
    data = {};
  }
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

// Generic page renderer
function render(request, response, data) {
  renderTemplate("layout", data, function(err, html) {
    if (err) {
      response.simpleText(500, err.stack);
      return;
    }
    response.simpleHtml(200, html);
  });
  
}

var Wheat = module.exports = function (repo, port) {
  Git(repo); // Connect to the git repo
  var server = NodeRouter.getServer();
  server.get("/", function (request, response) {
    clearCache(); // TODO: remove when done
    
    Step(
      function () {
        Git.getTags(this.parallel());
        Git.readDir("authors", this.parallel());
      },
      function (err, tags, results) {
        if (err) {
          response.simpleText(500, err.stack);
          return;
        }
        var data = {
          tags: tags.map(function (sha, tag) {
            return {
              name: tag,
              href: "/version/" + sha
            };
          }),
          authors: results.files.map(function (file) {
            var name = file.replace(/\.markdown$/, '');
            return {
              name: name,
              href: '/authors/' + name
            };
          })
        };
        data.tags.unshift({name:"HEAD", href:"/"});
        renderTemplate('index', data, this);
      },
      function (err, content) {
        if (err) {
          response.simpleText(500, err.stack);
          return;
        }
        render(request, response, {
          title: "Index",
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
  });

  server.listen(port);
};

// Test it!
Wheat("/Users/tim/Code/howtonode.org", 8080);
