var express = require('express');
var partials = require('express-partials');
var Rdio = require('rdio-node').Rdio;
var config = require('./config_provider');
var CookieStore = require('./cookie-store').CookieStore;

var app;

var useSSL = process.env.NODE_ENV == 'production';

var getRequestItems = function(req) {
  if(req.method === 'POST') {
    return req.body;
  }
  return {};
};

var endpoints = {
  main: '',
  install: 'install',
  loginBegin: 'auth/begin',
  loginEnd: 'auth/end',
  logout: 'auth/logout'
};

var handlers = {

  /** Handler for the main page that either shows data or asks the user to log in. */
  main: function(req, res) {
    res.contentType('text/html');

    var rdio = getRdioClient(getStore(req));

    // Make a request to the currentUser method.
    rdio.makeRequest('currentUser', function(error, results) {
      if (error) {
        res.render('main', {
          authorized: false,
          loginEndpoint: endpoints.loginBegin
        });
        return;
      }

      res.render('main', {
        authorized: true,
        name: results.result.firstName + ' ' + results.result.lastName,
        logoutEndpoint: endpoints.logout
      });
    });
  },

  install: function(req, res) {
    res.contentType('text/html');
    res.render('install');
  },

  /** Handler to begin the login process. */
  loginBegin: function(req, res) {
    var store = getStore(req);
    var rdio = getRdioClient(store);

    rdio.beginAuthentication(function(error, loginUrl) {
      if (error) {
        res.send('Error beginning request: ' + JSON.stringify(error));
        return;
      }
      store.write(res, useSSL, function() {
        res.redirect(loginUrl);
      });
    });
  },

  /** Handler to end the login process. */
  loginEnd: function(req, res) {
    var verifier = req.param('oauth_verifier');

    if (!verifier) {
      res.render('auth-error', {
        mainEndpoint: '/' + endpoints.main
      });
      return;
    }

    var store = getStore(req);
    var rdio = getRdioClient(store);

    rdio.completeAuthentication(req.param('oauth_verifier'), function() {
      // Save the auth token to the cookie and then redirect to the main page.
      store.write(res, useSSL, function() {
        res.redirect('/' + endpoints.main);
      });
    });
  },

  /** Clears the cookie store. */
  logout: function(req, res) {
    var store = getStore(req);
    store.removeAll();
    store.write(res, useSSL, function() {
      res.redirect('/' + endpoints.main);
    });
  },

  proxy: function(req, res) {
    var method = req.params.method;
    var req_args = getRequestItems(req);

    var origin = req.header('Origin');
    var allowedOrigins = config.get('accessControlAllowOrigin').split(',');

    if(allowedOrigins.length === 1 && allowedOrigins[0] === '*') {
      res.header('Access-Control-Allow-Origin', '*');
    }
    else if(origin && allowedOrigins.indexOf(origin) >= 0) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    var rdio = getRdioClient(getStore(req));

    rdio.makeRequest(req.params.method, req_args, function() {
      res.send(arguments);
    });
  }
};

var setSecure = function(req, res, next) {
  if(useSSL) {
    if(req.headers['x-forwarded-proto'] != 'https') {
      res.redirect(getServerUrl(req.url));
      return;
    }
    res.header('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
};

function createServer(args) {
  app = express();
  app.use(partials());
  app.use(express.bodyParser());
  app.use(express.static(__dirname + '/public'));
  app.set('view engine', 'ejs');

  app.all('*', setSecure);

  app.get('/' + endpoints.main, handlers.main);
  app.get('/' + endpoints.install, handlers.install);
  app.get('/' + endpoints.loginBegin, handlers.loginBegin);
  app.get('/' + endpoints.loginEnd, handlers.loginEnd);
  app.get('/' + endpoints.logout, handlers.logout);

  app.post('/:method', handlers.proxy);

  app.listen(args.port);
}

function getRdioClient(store) {
  return new Rdio({
    consumerKey: config.get('consumerKey'),
    consumerSecret: config.get('consumerSecret'),
    authorizeCallback: getCallbackUrl(endpoints.loginEnd),
    dataStore: store
  });
}

function getStore(req) {
  var store = new CookieStore();
  store.load(req);
  return store;
}

function getServerUrl(path) {
  var port = '';
  if(config.get('serverPort') != 80) {
    port = ':' + config.get('serverPort').toString();
  }
  return config.get('serverHostName') + port + '/' + path;
}

function getCallbackUrl(serverEndpoint) {
  return getServerUrl(serverEndpoint);
}

function setUp() {
  var args = { port: process.env.PORT || config.get('serverPort') };
  createServer(args);
}

setUp();
