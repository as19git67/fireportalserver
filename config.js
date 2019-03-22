const nconf = require('nconf');
const fs = require('fs');
const path = require('path');

const configFilename = 'settings.json';
let configFilepath = path.join(__dirname, configFilename);
nconf.argv().env().file({file: configFilepath});
nconf.listenForChange = function (callback) {
  if (_.isFunction(callback)) {
    console.log("Callback installed to listen for changes");
    nconf.settingsChangedCallback = callback;
  } else {
    delete nconf.settingsChangedCallback;
  }
};

watchForConfigChange(configFilepath);

function watchForConfigChange(cfgFilepath) {
  console.log("watchForConfigChange started");
  let reloadingTimer;
  let waitForFileExistsInterval;

  if (fs.existsSync(cfgFilepath)) {
    let isInRename = false;
    fs.watch(cfgFilepath, (event, filename) => {
      switch (event) {
      case 'rename':
        if (isInRename) {
          return;
        }
        isInRename = true;
        console.log(cfgFilepath + " renamed to " + filename);
        // wait for file to be back again
        if (!waitForFileExistsInterval) {
          clearInterval(waitForFileExistsInterval);
        }
        waitForFileExistsInterval = setInterval(() => {
          fs.exists(cfgFilepath, function (exist, a) {
            if (exist) {
              clearInterval(waitForFileExistsInterval);
              nconf.load(function (err) {
                if (err) {
                  console.log("Reloading configuration file after rename" + cfgFilepath + " failed: " + err.toString());
                } else {
                  console.log("Reloaded configuration after rename from " + cfgFilepath);
                  if (nconf.settingsChangedCallback) {
                    nconf.settingsChangedCallback();
                  }
                }
                console.log("watching again for changes in configuration file " + cfgFilepath);
                watchForConfigChange(cfgFilepath);
              });
            }
          });
        }, 1500);
        isInRename = true;
        break;
      case 'change':
        console.log(cfgFilepath + " changed");
        if (!reloadingTimer) {
          clearTimeout(reloadingTimer);
          reloadingTimer = undefined;
        }
        reloadingTimer = setTimeout(() => {
          reloadingTimer = undefined;
          nconf.load(function (err) {
            if (err) {
              console.log("Reloading configuration file after change" + cfgFilepath + " failed: " + err.toString());
            } else {
              console.log("Reloaded configuration after change from " + cfgFilepath);
            }
          });
        }, 2000);

        break;
      default:
        console.log(cfgFilepath + ' changed ', event);
      }
    });
  } else {
    console.log("WARNING: settings.json does not exist");
  }
}

nconf.defaults({
  "httpPort": 5005,
  "certPath": "",
  "keyFilename": "key.pem",
  "certFilename": "cert.pem",
  "bearerTokens": {
    "token1": {"name": "user1", "canRead": true, "isAdmin": true, "expiredAfter": "2018-12-31T23:59:59.999Z"},
    "token2": {"name": "user2", "canRead": true, "isAdmin": true, "expiredAfter": "2018-12-31T23:59:59.999Z"}
  },
  "tokenLifetimeInMinutes": 3,
  "email_smtp_sender_email": "",
  "email_smtp_username": "",
  "email_smtp_password": "",
  "email_smtp_use_SSL": false,
  "email_smtp_server_host": "",
  "email_smtp_server_port": ""
});

module.exports = nconf;
