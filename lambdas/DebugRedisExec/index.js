/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const ssm = new AWS.SSM();
const redis = require('ioredis');

const AFFEXTED_MSG = `row's affected`;

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
    }

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

    let { redisCommand = "" } = JSON.parse(event.body);
    let response = {};

    try {
        //console.log("get data", await cluster.hgetall("item:567:1:info"));
        console.log('start execution --------------->>>')

        if (redisCommand) {
            const commands = redisCommand.split('\n').filter(item => item !== '' && item !== undefined && item !== null);
            let commandOutput = [];

            for (const command of commands) {
                const result = await executeCommand(command);

                commandOutput.push(result)
            }

            response = commandOutput;
        }

        return getResponse(response, 200);

    } catch (error) {
        console.log("error:", error);
        return getResponse(error, 400);

    } finally {
        await cluster.disconnect();
    }


    async function executeCommand(redisCommand) {
        let output = '';

        const keysArr = redisCommand.split(" ")
            .map(x => x.trim())
            .filter(item => item !== '' && item !== undefined && item !== null);

        console.log('loooooooooooo', keysArr)

        //Handle woldcard delete command
        if (keysArr[0].toLowerCase() == 'del') {
            output = await deleteKeysWithPattern(cluster, keysArr.slice(1).join(' '));
        }
        //Handle other command except woldcard delete
        else {
            const pipeline = cluster.pipeline();
            // Adding the custom command to the pipeline
            pipeline.call(...keysArr);


            const results = await pipeline.exec();
            if (results[0][0]) {
                output = { success: false, results: undefined }
            }
            else {
                let isSuccess = false;
                let outputResults = results[0][1];

                if (Array.isArray(results[0][1]) && results[0][1].length > 0) {
                    isSuccess = true;

                    try {
                        JSON.parse(outputResults[0]);
                        outputResults = results[0][1].map(x => JSON.stringify(JSON.parse(x), null, 4))
                    } catch (e) { console.log('Error during parse json 1') }
                }
                else if (results[0][1]) {
                    isSuccess = true;

                    console.log('my check ', outputResults)

                    try {
                        JSON.parse(outputResults);
                        outputResults = JSON.stringify(JSON.parse(outputResults), null, 4);
                    } catch (e) { console.log('Error during parse json 2') }
                }

                output = { success: isSuccess, results: outputResults }
            }
        }

        return output;
    }

    async function deleteKeysWithPattern(cluster, pattern) {
        let cursor = '0';
        let keys = [];

        do {
            const result = await cluster.scan(cursor, 'MATCH', pattern);
            cursor = result[0];
            keys = keys.concat(result[1]);
        } while (cursor !== '0');

        console.log('my del keys ------>', keys)

        if (keys.length > 0) {
            const pipeline = cluster.pipeline();

            keys.forEach((key) => pipeline.del(key));

            const results = await pipeline.exec();
            console.log('final result ---->', results)
            const affectedRows = results.filter(x => x[0] == null).length;

            return { success: true, results: `${affectedRows} ${AFFEXTED_MSG}` }

        } else {
            console.log('No keys found matching the pattern.');
            return { success: false, results: `0 ${AFFEXTED_MSG}` }
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