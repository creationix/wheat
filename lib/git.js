var ChildProcess = require('child_process'),
    path = require('path'),
    sys = require('sys'),
    fs = require('fs');

var fileCache = {};
var dirCache = {};
var tagsCache;
var gitCommands, gitDir;

// Set up the git configs for the subprocess
var Git = module.exports = function (repo) {
  // Check the directory exists first.
  try {
    fs.statSync(repo);
  } catch (e) {
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
  
};

// Internal helper to talk to the git subprocess
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
      callback(new Error("git " + commands.join(" ") + "\n" + stderr));
    } else {
      callback(null, stdout);
    }
  });
}

// Loads a file from a git repo
Git.readFile = function readFile(path, version, callback) {
  // version defaults to HEAD
  if (typeof version === 'function' && typeof callback === 'undefined') {
    callback = version;
    version = "HEAD";
  }
  path = version + ":" + path;
  if (fileCache[path]) {
    callback(null, fileCache[path]);
  } else {
    gitExec(["show", path], function (err, text) {
      if (err) {
        callback(err);
        return;
      }
      fileCache[path] = text;
      callback(null, text);
    });
  }
};

// Reads a directory at a given version and returns an objects with two arrays
// files and dirs.
Git.readDir = function readDir(path, version, callback) {
  // version defaults to HEAD
  if (typeof version === 'function' && typeof callback === 'undefined') {
    callback = version;
    version = "HEAD";
  }
  var combined = version + ":" + path;
  Git.readFile(path, version, function (err, text) {
    if (err) {
      callback(err);
      return;
    }
    if (!(/^tree .*\n\n/).test(text)) {
      callback(new Error(combined + " is not a directory"));
      return;
    }
    text = text.replace(/^tree .*\n\n/, '').trim();
    var files = [];
    var dirs = [];
    text.split("\n").forEach(function (entry) {
      if (/\/$/.test(entry)) {
        dirs[dirs.length] = entry.substr(0, entry.length - 1);
      } else {
        files[files.length] = entry;
      }
    })
    callback(null, {
      files: files,
      dirs: dirs
    });
  });
};

// Gets a list of tags from the repo. The result is an object with tag names
// as keys and their sha1 entries as the values
Git.getTags = function (callback) {
  if (tagsCache) {
    callback(null, tagsCache);
  } else {
    gitExec(["show-ref", "--tags"], function (err, text) {
      if (err) {
        callback(err);
      }
      tagsCache = {};
      text.trim().split("\n").forEach(function (line) {
        var match = line.match(/^([0-9a-f]+) refs\/tags\/(.*)$/);
        tagsCache[match[2]] = match[1];
      })
      callback(null, tagsCache);
    });
  }
}

// Returns the tags for which a path exists
Git.exists = function (path, callback) {
  Git.getTags(function (err, tags) {
    tags.HEAD = "HEAD";
    if (err) { throw err; }
    var exists = {};
    var count = Object.keys(tags).length;
    Object.keys(tags).forEach(function (tag) {
      Git.readFile(path, tags[tag], function (err, text) {
        if (!err) {
          exists[tag] = tags[tag];
        }
        count--;
        if (count <= 0) {
          callback(null, exists);
        }
      });
    });
  });
}

// Clears the caches so that we can load fresh content again.
Git.clearCache = function () {
  fileCache = {};
  dirCache = {};
  tagsCache = undefined;
};

// Test it!
// Git("/Users/tim/code/node");
// Git("/Users/tim/git/howtonode.org.git");
// Git.exists("articles/control-flow-part-ii.markdown", function (err, tags) {
//   if (err) { throw(err); }
//   sys.p(tags);
// });
// Git.getTags(function (err, tags) {
//   if (err) { throw(err); }
//   Object.keys(tags).forEach(function (tag) {
//     Git.readDir("articles", tags[tag], function (err, contents) {
//       if (err) { throw(err); }
//       contents.files.forEach(function (file) {
//         file = path.join("articles", file);
//         Git.readFile(file, tags[tag], function (err, text) {
//           if (err) { throw(err); }
//           sys.error("tag: " + tag + " sha1: " + tags[tag] + " file: " + file + " length: " + text.length);
//         });
//       });
//     });
//   });
// });
