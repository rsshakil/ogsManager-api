/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');
const ssm = new AWS.SSM();
const redis = require("ioredis");
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
    }
    const ENVID = process.env.ENVID;
    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 },
    ];
    const cluster = new redis.Cluster(redisConfig, {
        dnsLookup: (address, callback) => callback(null, address),
        redisOptions: { tls: true },
    });

    let parameter = [];
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null } = event || {};
        const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort } = queryStringParameters || {};

        console.log('my filter is ', filter);

        let where = '';
        if (filter) {
            const { condition = '', conditionParameters = [] } = commonFunctions.getWhereFromFilter(filter);

            where = condition;
            parameter = [...parameter, ...conditionParameters];
        }

        console.log('my where is ', where);
        console.log('my where parameter is ', parameter);

        let orderBy = commonFunctions1.convertToMySQLSort(sort, 'gachaOrder ASC');


        const sql_count = `
        SELECT 
            COUNT(gachaId) AS total_rows
        FROM Gacha 
        JOIN GachaTranslate on gachaTranslateGachaId = gachaId
        ${where}
        AND gachaStatus = ? AND gachaOrder != ? and  gachaTranslateJpFlag = ?`;
        const [query_result_count] = await mysql_con.query(sql_count, [...parameter, 1, 0, 1]);

        const gacha_query = `
            SELECT 
                gachaId,
                CASE 
                    WHEN gachaStatus = 3 THEN 3
                    ELSE gachaViewFlag
                END AS gachaStatus,
                gachaSoldOutFlag,
                gachaPostStartDate*1000 AS gachaPostStartDate,
                gachaStartDate*1000 AS gachaStartDate,
                gachaEndDate*1000 AS gachaEndDate,
                gachaRemainingDisplayFlag,
                gachaTranslateName, 
                gachaOrder,
                gachaTotalCount,
                gachaRemainingCount
            FROM Gacha 
            JOIN GachaTranslate on gachaTranslateGachaId = gachaId 
            ${where}
            AND gachaStatus = ? AND gachaOrder != ? AND gachaTranslateJpFlag = ? 
            ${orderBy}
            LIMIT ?, ?`;

        const [query_result_data] = await mysql_con.query(gacha_query, [...parameter, 1, 0, 1, Number(offset), Number(limit)]);

        // const addRemainDataResult = await Promise.all(query_result_data.map(async (row) => {
        //     row.gachaRemainCount = await cluster.llen("gacha:" + ENVID + ":" + row.gachaId + ":list");
        //     // console.log("row", row);
        //     return row;
        // }));

        response = {
            count: query_result_count[0]?.total_rows,
            records: query_result_data,
        };

        console.log('my response', response)

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        console.error("error:", error)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }
};