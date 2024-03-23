/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const ssm = new AWS.SSM();
const redis = require('ioredis');

/**
 * ManagerAppRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'PS_' + process.env.ENV,
            WithDecryption: true,
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        // console.log("dbinfo",dbinfo);
        process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
        process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
        process.env.ENVID = dbinfo.ENVID;
    }

    const ENVID = process.env.ENVID;

    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 }
    ];
    // ユーザー情報をRedisに書き出す

    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );


    let response = {};

    try {
        const redisKey = `shipping:${ENVID}:flag`;

        const result = await cluster.get(redisKey);
        console.log('lopppppp rrr', result);

        response = { records: result }

        return getResponse(response, 200);

    } catch (error) {
        console.log("error:", error);
        return getResponse(error, 400);

    } finally {
        try {
            await cluster.disconnect();
        } catch (err) {
            console.log('Error occurred during cluster disconnect')
        }
    }

    function getResponse(data, statusCode = 200) {
        return {
            statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(data),
        }
    }
};