# Wheat

Wheat is a blogging engine that reads a git repo full of markdown articles and presents them as a website.

Wheat engine takes a local git repository path as a parameter

	var wheat = require('wheat')("/path/to/my/repo");
	// wheat is now a function which handles request and return response:
	// wheat(req/*request*/, res/*response*/, next /*next handler to call for this request*/)
	
Here's an example using Connect ( npm install connect ) to start a server, adapted from https://github.com/creationix/howtonode.org/blob/master/app.js :

 var Connect = require('connect');
 
 var repository = "/path/to/my/repo",
 	port = 3000;
 
 Connect.createServer(
   Connect.logger(),
   Connect.conditionalGet(),
   Connect.favicon(),
   Connect.cache(),
   Connect.gzip(),
   require('wheat')(repository)
 ).listen(port);

## How to Install

Either manually install all the dependencies or use npm.

    npm install wheat

## Full example of how to use wheat :
	$> npm install wheat
	$> git clone https://github.com/creationix/howtonode.org.git
	$> cd howtonode.org
	$> node app.js

That's it!  Checkout the wheat branch of howtonode.org for an example of how to use the library.

<http://github.com/creationix/howtonode.org>
