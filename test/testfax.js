const fs = require('fs');
const moment = require('moment');
const request = require('request');
const util = require('util');
const _ = require('underscore');

let filename = 'fire.png';
let data = fs.readFileSync(filename);

let postData = {
    "number": "023922492",
    "date": moment().format(),
    "keyword": "B3",
    "catchword": "Brand",
    "longitude": "10.9833193",
    "latitude": "48.2397956",
    "street": "Steindorferstr.",
    "streetnumber": "22",
    "city": "Merching",
    "object": "",
    "resource": "LF",
    "alarmfax": {
        value: data,
        options: {
            filename: 'alarmfax',
            contentType: 'image/png'
        }
    }
};

let options = {
    restApiUrl: "http://localhost:5005/api/jobs",
    postData: postData,
    authorizationBearer: "96986",
    acceptSelfSignedCertificate: true
};

postJob(options, postData).then(results => {
    console.log(results)
}).catch(reason => {
    console.log(reason);
});

async function postJob(options, postData) {
    try {
        return await _sendRequest(options.restApiUrl, options.authorizationBearer, options.acceptSelfSignedCertificate, postData);
    } catch (ex) {
        console.log(`SENT failed. Results are:`);
        console.log(util.inspect(ex, {colors: true, depth: 10}));
    }
}


async function _sendRequest(restApiUrl, authorizationBearer, acceptSelfSignedCertificate, postData) {
    return new Promise((resolve, reject) => {

        const myURL = new URL(restApiUrl);
        let url = myURL.href;

        let reqOpts = {url: url, formData: postData};
        reqOpts.method = 'POST';
        if (authorizationBearer) {
            reqOpts.auth = {bearer: authorizationBearer};
        }
        if (acceptSelfSignedCertificate) {
            // console.log(`${pluginName}: accepting self signed certificate for ${restApiUrl}`);
            reqOpts.agentOptions = {
                insecure: true,
                rejectUnauthorized: false
            };
        }

        request(reqOpts, function optionalCallback(err, httpResponse, body) {
            if (err) {
                reject({message: err.message, url: reqOpts.url});
            } else {
                try {
                    let responseJson = JSON.parse(body);
                    resolve(_.extend(responseJson, {
                        httpStatusCode: httpResponse.statusCode,
                        url: reqOpts.url
                    }));
                } catch (err) {
                    console.log(body);
                    reject({
                        message: err.message,
                        httpStatusCode: httpResponse.statusCode,
                        url: reqOpts.url
                    });
                }
            }
        });

        delete reqOpts.auth;  // don't log auth data
        console.log(`request options are: ${util.inspect(reqOpts, {
            breakLength: Infinity,
            colors: true,
            depth: 0
        })}`);
    });
}
