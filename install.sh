#!/bin/bash
echo
echo "Loading dependencies as git submodules..."
git submodule init
git submodule update
echo
echo "Creating ~/.node_libraries folder if it doesn't exist yet..."
mkdir -p ~/.node_libraries
echo
echo "Linking current working copy into the .node_libraries folder..."
ln -sf `pwd`/lib/wheat.js ~/.node_libraries/wheat.js
rm ~/.node_libraries/wheat
ln -s `pwd`/lib/wheat ~/.node_libraries/wheat
echo
echo "Done, if you delete this current working directory `pwd`, you will lose your library."
echo "You can move it to a permanent place and re-run install if desired."
echo
echo "Enjoy blogging with Wheat!"
echo