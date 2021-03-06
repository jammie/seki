/*
 * Main Seki script

 * 
 * see README.md
 */

/* TODO
 * change to using http.request
 */

/*
 * library module imports
 */
var http = require('http');
var fs = require('fs'); // filesystem module
var qs = require('querystring'); // POST parameters parser
var static = require('node-static');

var verbose = true;

/*
 * Seki support scripts imports
 */
var templater = require('./templater');
var sparqlTemplates = require('./sparqlTemplates');
var htmlTemplates = require('./htmlTemplates');

var TurtleHandler = require('./TurtleHandler');
var JSONHandler = require('./JSONHandler');
var Admin = require('./admin/Admin');
var config = require('./ConfigDefault').config;

var sekiHeaders = {
	"Content-type" : "text/html; charset=utf-8",
	"Connection" : "keep-alive", // added later
	"Transfer-Encoding" : "chunked"
};
// this version will be modified
var sekiHeaders2 = {
	"Content-type" : "text/html; charset=utf-8"
};

var graphHeaders = {
	// "Accept" : "application/rdf+xml",
	"Accept" : "text/turtle",
	"Host" : config.sekiHost + ":" + config.sekiPort
};

var sparqlHeaders = {
	"Accept" : "application/sparql-results+xml",
	"Host" : config.sekiHost + ":" + config.sekiPort
};

var postHeaders = {
	"Accept" : "application/sparql-results+xml",
	"Host" : config.sekiHost + ":" + config.sekiPort,
	'Content-Type' : 'application/x-www-form-urlencoded'
};

/*
 * mapping URIs to static files on the filesystem
 * 
 */
var files = {
	"/" : config.wwwDir + "/index.html",
	"/index" : config.wwwDir + "/index.html",
	"/form" : config.wwwDir + "/form.html",
	"404" : config.wwwDir + "/404.html"
};

//
// Create a node-static server to serve the current directory
//
var file = new (static.Server)(config.wwwDir, {
	cache : 7200
});

// set it running
http.createServer(onRequest).listen(config.sekiPort, config.sekiHost);

verbosity("Seki serving on " + config.sekiHost + ":" + config.sekiPort);
verbosity("addressing SPARQL on " + config.sparqlHost + ":" + config.sparqlPort);

/*
 * Callback to handle HTTP requests (typically from browser)
 */
function onRequest(sekiRequest, sekiResponse) {
	verbosity("SEKI REQUEST HEADERS " + JSON.stringify(sekiRequest.headers));
	verbosity("REQUEST URL = " + sekiRequest.url);
	verbosity("REQUEST METHOD = " + sekiRequest.method);

	// check for corresponding files on the filesystem
	if (sekiRequest.method == "GET") {
		file.serve(sekiRequest, sekiResponse, function(err, res) {
			if (err) { // the file doesn't exist, leave it to Seki
			} else { // The file was served successfully
				verbosity(sekiRequest.url + " - " + res.message);
			}
		});
	}

	verbosity("got past file server");

	// handle admin requests/commands
	if (sekiRequest.method == "POST") {
		if (sekiRequest.url.substring(0, 7) == "/admin/") {
			var command = sekiRequest.url.substring(7);
			var admin = new Admin(sekiRequest, sekiResponse);
			if (admin[command]) {
				sekiResponse.writeHead(202, sekiHeaders);
				sekiResponse.end("202 Accepted for command '" + command + "'");
				admin[command](); // perhaps this should spawn a separate OS
									// process?
				return;
			} else {
				sekiResponse.writeHead(404, sekiHeaders);
				sekiResponse.end("404 Not Found. Admin command '" + command
						+ "' unknown");
				return;
			}
		}
	}

	// the client that will talk to the SPARQL server
	var client = http.createClient(config.sparqlPort, config.sparqlHost);

	// the URI used in the RDF
	var resource = config.uriBase + sekiRequest.url;
	var accept = sekiRequest.headers["accept"];

	if (accept && accept.indexOf("application/json") == 0) {
		var handler = new JSONHandler();
		return handler[sekiRequest.method]();
	}
	// verbosity("Accept header =" + accept
	// + accept.indexOf("application/rdf+xml" == 0));

	// TODO pull these out into separate per-media type handlers
	// use pattern as for JSONHandler
	if (sekiRequest.method == "GET") {

		if (accept && accept.indexOf("text/turtle") == 0) {
			verbosity("text/turtle requested");
			var handler = new TurtleHandler();
			handler.GET(resource, sekiResponse);
			return;
		}

		// Assume HTML is acceptable

		// build the query
		var queryTemplater = templater(sparqlTemplates.itemTemplate);
		var replaceMap = {
			"uri" : resource
		};
		var sparql = queryTemplater.fillTemplate(replaceMap);

		// build the URL from the query
		var queryPath = config.sparqlQueryEndpoint + "?query=" + escape(sparql);

		// make the request to the SPARQL server
		var clientRequest = client.request("GET", queryPath, sparqlHeaders);

		// verbosity("QUERY = "+sparql);

		// handle the response from the SPARQL server
		clientRequest.on('response', function(queryResponse) {
			serveHTML(resource, sekiResponse, queryResponse);
		});

		// finish up
		sekiRequest.on('end', function() {
			// verbosity("End of sekiRequest");
			clientRequest.end();
		});
		return;
	}

	if (sekiRequest.method == "POST") {
		// verbosity("Start of POST");

		/*
		 * start building query - but it needs the data supplied in the body of
		 * the request by the browser
		 */
		var queryTemplater = templater(sparqlTemplates.insertTemplate);
		var post_body = '';

		// request body may come in chunks, join them together
		sekiRequest.on('data', function(chunk) {
			post_body += chunk;
		});

		// now received body of request
		sekiRequest.on('end', function() {

			// turn the POST parameters into JSON
			var replaceMap = qs.parse(post_body);
			replaceMap["date"] = new Date().toJSON();

			// verbosity("ReplaceMap = "+JSON.stringify(replaceMap));

			// can now make the query
			var sparql = queryTemplater.fillTemplate(replaceMap);

			/*
			 * make the request to the SPARQL server the update has to be POSTed
			 * to the SPARQL server
			 */
			var clientRequest = client.request("POST",
					config.sparqlUpdateEndpoint, postHeaders);

			// send the update query as POST parameters
			clientRequest.write(qs.stringify({
				"update" : sparql
			}));

			// verbosity(queryPath);
			// verbosity(post_body);
			// verbosity(sparql);

			clientRequest.end();

			// handle the response from the SPARQL server
			clientRequest.on('response', function(queryResponse) {

				var relativeUri = replaceMap.uri
						.substring(config.uriBase.length);

				// do a redirect to the new item
				sekiHeaders2["Location"] = relativeUri;
				sekiResponse.writeHead(303, sekiHeaders2);
				// all done
				sekiResponse.end();
			});
		});
	}
}

/*
 * Handles GET requests (typically from a browser)
 */
function serveHTML(resource, sekiResponse, queryResponse) {

	// set up HTML builder
	var viewTemplater = templater(htmlTemplates.viewTemplate);
	// verbosity("GOT RESPONSE ");

	var saxer = require('./srx2map');
	var stream = saxer.createStream();

	sekiResponse.pipe(stream);

	queryResponse.on('data', function(chunk) {
		stream.write(chunk);
	});

	queryResponse.on('end', function() {

		stream.end();

		var bindings = stream.bindings;
		if (bindings.title) { // // this is ugly
			verbosity("GOT: " + JSON.stringify(bindings));
			// verbosity("TITLE: " + bindings.title);
			verbosity("WRITING HEADERS " + JSON.stringify(sekiHeaders));
			sekiResponse.writeHead(200, sekiHeaders);
			var html = viewTemplater.fillTemplate(bindings);
		} else {
			verbosity("404");
			sekiResponse.writeHead(404, sekiHeaders);
			// /////////////////////////////// refactor
			var creativeTemplater = templater(htmlTemplates.creativeTemplate);
			var creativeMap = {
				"uri" : resource
			};
			var html = creativeTemplater.fillTemplate(creativeMap);
			// ///////////////////////////////////////////
			// serveFile(sekiResponse, 404, files["404"]);
			// return;
		}
		// sekiResponse.writeHead(200, {'Content-Type': 'text/plain'});
		// verbosity("HERE "+html);
		// sekiResponse.write(html, 'binary');
		sekiResponse.end(html);
	});
};

/*
 * Reads a file from the filesystem and writes its data to response (typically a
 * browser)
 */
function serveFile(sekiResponse, status, file) {
	verbosity("FILE = " + file);

	fs.readFile(file, function(err, data) {
		if (err) {
			data = "Error :" + err;
			status = 500;
		}
		sekiResponse.writeHead(status, sekiHeaders); // queryResponse.headers
		sekiResponse.write(data, 'binary');
		sekiResponse.end();
	});
}

function verbosity(message) {
	if (verbose)
		console.log(message);
}
// }
