var ChildProcess = require('child_process'),
    path = require('path'),
    sys = require('sys'),
    fs = require('fs'),
    Git = require('./git');


var Wheat = module.exports = function (repo) {
  // Connect to the git repo
  Git(repo);
  Git.readFile("articles/prototypical-inheritance.markdown", function (err, markdown) {
    if (err) { throw (err); }
    sys.puts(markdown);
  });
  
};

// Test it!
Wheat("/Users/tim/git/howtonode.org.git");
