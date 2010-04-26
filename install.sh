#!/bin/bash
echo
echo "Loading dependencies as git submodules..."
git submodule init
git submodule update
if [ ! -n "$NODE_PATH" ]; then
  NODE_PATH="$HOME/.node_libraries"
fi
if [ ! -d $NODE_PATH ]; then
  echo
  echo "Creating $NODE_PATH folder"
  mkdir -p "$NODE_PATH"
fi
echo
echo "Linking current working copy into the $NODE_PATH folder..."
ln -sf `pwd`/lib/wheat.js $NODE_PATH/wheat.js
if [ -d $NODE_PATH/wheat ]; then
  rm -rf $NODE_PATH/wheat
fi
ln -s `pwd`/lib/wheat $NODE_PATH/wheat
echo "Linking wheat binary to ~/bin..."
mkdir -p ~/bin
ln -sf `pwd`/bin/wheat ~/bin/wheat
echo
echo "Done, if you delete this current working directory `pwd`, you will lose your library."
echo "You can move it to a permanent place and re-run install if desired."
echo
echo "Enjoy blogging with Wheat!"
echo