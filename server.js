#!/usr/local/bin/iojs
"use strict";

var logger = require('koa-logger');
var conditional = require('koa-conditional-get');
var etag = require('koa-etag');
var newWheat = require('./renderers');
var koa = require('koa');
var app = koa();

console.log("Initializing git vfs...");

console.log("Configuring HTTP middleware...");
app.use(logger());
app.use(conditional());
app.use(etag());
app.use(newWheat("git://github.com/creationix/howtonode.org.git"));

console.log("Starting up HTTP server...");
app.listen(process.env.PORT || 8080);

console.log("Ready.");
