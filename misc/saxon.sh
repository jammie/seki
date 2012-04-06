#!/bin/bash
#
# ./saxon.sh rdf2html.xsl ../data/samples/post.rdf > ../data/samples/post-rhizome.html
#
java -cp /home/java/saxon9he.jar net.sf.saxon.Transform -xsl:$1 -s:$2 
# $3 $4
# java net.sf.saxon.Transform -s:source -xsl:stylesheet -o:output
