var ChildProcess = require('child_process'),
    path = require('path'),
    sys = require('sys'),
    fs = require('fs'),
    Git = require('./git'),
    haml = require('haml'),
    markdown = require('markdown'),
    Step = require('./step'),
    NodeRouter = require('node-router');

var Wheat = module.exports = function (repo, port) {
  Git(repo); // Connect to the git repo
  var server = NodeRouter.getServer();
  server.get("/", function (request, response) {
    return "<h1>TODO: Implement!</h1>";
  });
  
  // Load static files from the "skin/public/" folder of the git repo.
  server.get(/^\/(.*\.[a-z]{2,4})$/, function (request, response, filename) {
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
Wheat("/Users/tim/git/howtonode.org.git", 8080);
