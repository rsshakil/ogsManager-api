/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const crypto = require("crypto");
const redis = require('ioredis');

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;
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
            WithDecryption: true
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
        process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
        process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
        process.env.ENVID = dbinfo.ENVID;
        process.env.REGISTURL = dbinfo.REGISTURL
        process.env.MAILFROM = dbinfo.MAILFROM
        process.env.DIRECTION = dbinfo.DIRECTION;
    }

    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    const ENVID = process.env.ENVID;
    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 }
    ];
    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );

	const nowTimestamp = Math.floor(new Date().getTime() / 1000);
    const DIRECTION = (process.env.DIRECTION)?process.env.DIRECTION:1;
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null } = event || {};
        const { listType, patternType } = queryStringParameters || {};
        console.log('listType', listType);
        console.log('patternType', patternType);
        if (!patternType) {
            return getResponse({message: 'Pattern type empty'}, 101);
        }
        if (listType === "pattern") {
            const ipBlockPatternSql = 'SELECT * FROM IPBlockPattern WHERE ipBlockPatternType = ? ORDER BY ipBlockPatternOrder ASC';
            const [ipBlockPatternResult] = await mysql_con.query(ipBlockPatternSql, [patternType]);
            response = {
                count: ipBlockPatternResult.length,
                records: ipBlockPatternResult
            };
            return getResponse(response, 200);
        }

		// blocklistのチェック
        const ipBlockKey = `ipblock:${ENVID}:${patternType}:list`;
        const ipBlockConditionKey = `ipblock:${ENVID}:${patternType}:condition`;
		console.log('ipBlockKey', ipBlockKey);
        const ipBlockList = await cluster.zrange(ipBlockKey, 1, 9999999999, "BYSCORE", "WITHSCORES");
        const ipBlockConditionList = await cluster.zrange(ipBlockConditionKey, 1, 9999999999, "BYSCORE", "WITHSCORES");
		console.log("ipBlockList", ipBlockList);
        console.log("ipBlockConditionList", ipBlockConditionList);
		
		// Transform the ipBlockList into the expected result format
        let formattedBlockList = [];

        for (let i = 0; i < ipBlockList.length; i += 2) {
            let ip = ipBlockList[i];
            let deadline = ipBlockList[i + 1] * 1000;
            let bid = ipBlockConditionList[ipBlockConditionList.indexOf(ip) + 1];

            formattedBlockList.push({
                blockIPAddress: ip,
                blockApplicationDeadline: deadline,
                bid: bid
            });
        }

        // Sort the array based on 'blockApplicationDeadline'
        formattedBlockList.sort((a, b) => b.blockApplicationDeadline - a.blockApplicationDeadline);

		response = {
			count: formattedBlockList.length,
			records: formattedBlockList
		};

		return getResponse(response, 200);
    } catch (error) {
        console.error("error:", error)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify({
                errorCode: 501,
                message: "user create error"
            }),
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }

	function getResponse(data, statusCode = 200) {
		return {
			statusCode,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: JSON.stringify(data),
		};
	}
};
