var ChildProcess = require('child_process'),
    path = require('path'),
    sys = require('sys'),
    fs = require('fs');

var Git;

var fileCache = {};

var Wheat = module.exports = function (repo) {
  var gitCommands, gitDir;
  // Check the directory exists first.
  try {
    fs.statSync(repo);
  } catch (e) {
    throw e;
    throw new Error("Bad repo path: " + repo);
  }
  
  try {
    // Check is this is a working repo
    gitDir = path.join(repo, ".git")
    fs.statSync(gitDir);
    gitCommands = ["--git-dir=" + gitDir, "--work-tree=" + repo];
  } catch (e) {
    gitDir = repo;
    gitCommands = ["--git-dir=" + gitDir];
  }
  
  function gitExec(commands, callback) {
    commands = gitCommands.concat(commands);
    var child = ChildProcess.spawn("git", commands);
    var stdout = "", stderr = "";
    child.stdout.addListener('data', function (text) {
      stdout += text;
    });
    child.stderr.addListener('data', function (text) {
      stderr += text;
    });
    child.addListener('exit', function (code) {
      if (code > 0) {
        throw new Error("git " + commands.join(" ") + "\n" + stderr);
      } else {
        callback(stdout);
      }
    });
  }
  Git = {
    readFile: function (path, version, callback) {
      // version defaults to HEAD
      if (typeof version === 'function' && typeof callback === 'undefined') {
        callback = version;
        version = "HEAD";
      }
      path = version + ":" + path;
      if (fileCache[path]) {
        callback(fileCache[path]);
      }
      gitExec(["show", path], function (text) {
        fileCache[path] = text;
        callback(text);
      });
    },
    flushCache: function () {
      fileCache = {};
    }
  }
  
};

// Test it!
Wheat("/Users/tim/git/howtonode.org.git");
Git.readFile("articles/prototypical-inheritance.markdown", sys.error);
