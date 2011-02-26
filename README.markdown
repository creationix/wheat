# Wheat

Wheat is a blogging engine that reads a git repo full of markdown articles and presents them as a website.

Wheat engine takes a local git repository path as a parameter

	var wheat = require('wheat')("/path/to/my/repo");
	// wheat is now a function which handles request and return response:
	// wheat(req/*request*/, res/*response*/, next /*next handler to call for this request*/)
	
Here's an example using Connect ( npm install connect ) to start a server, adapted from [howtonode.org repo app.js](https://github.com/creationix/howtonode.org/blob/master/app.js) :

 var Connect = require('connect');
 
 var repository = "/path/to/my/repo";
 
 Connect.createServer(
   Connect.logger(),
   Connect.conditionalGet(),
   Connect.favicon(),
   Connect.cache(),
   Connect.gzip(),
   require('wheat')(repository)
 ).listen(3000);

## How to Install

Either manually install all the dependencies or use npm.

    npm install wheat

For on the fly rendering of Graphviz graphs (DOT files), Graphviz will need to be [installed](http://www.graphviz.org/Download..php)


## Full example of how to use wheat, using howtonode.org [repository](http://github.com/creationix/howtonode.org) for skin/articles/... :
	$> npm install wheat
	$> git clone https://github.com/creationix/howtonode.org.git
	$> cd howtonode.org
	
Then edit app.js and add ".listen(3000);" at the end of "Connect.createServer", see above.

Now just run it, and open your browser on [your host, port 3000](http://127.0.0.1:3000)
	
	$> node app.js

That's it!