/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');
const ssm = new AWS.SSM();
const redis = require('ioredis');

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKey = {
    gachaEmissionBonusItemName: 'GachaEmissionBonusItemTranslate.itemTranslateName',
    gachaEmissionItemName: 'ItemTranslate.itemTranslateName'
};


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
    // ユーザー情報をRedisに書き出す
    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );

    let parameter = [];
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null, pathParameters: { gachaId } } = event || {};

        if (!gachaId > 0) {
            return getResponse({ message: 'gachaId is missing in pathParameters.' }, 507);
        }

        const return_rate_cal_query = `
        SELECT
            CASE WHEN (gachaBuildStatus = 1 || gachaStatus = 3 || gachaStatus = 4 || (gachaTotalCount * gachaSinglePoint) = 0) THEN 0 ELSE ((SUM(gachaEmissionItemPoint) + SUM(CASE WHEN gachaPrizeType > 1 AND gachaPrizeType <= 9 THEN gachaEmissionBonusItemPoint ELSE 0 END)) / (gachaTotalCount * gachaSinglePoint)) END AS returnRate
        FROM GachaEmission 
        LEFT OUTER JOIN GachaPrize ON gachaPrizeId = gachaEmissionBonusPrizeId
        WHERE gachaEmissionGachaId = gachaId 
        GROUP BY gachaEmissionGachaId`;

        const gacha_data_query = `
            SELECT 
                gachaId, 
                gachaRemainingCount,
                gachaTranslateName,
                gachaStatus,
                gachaBuildStatus,
                gachaStopStatus,
                gachaDeployStatus,
                gachaBuildError,
                gachaLoopFlag,
                gachaDirectionId,
                gachaLimitCount,
                (${return_rate_cal_query}) AS returnRate,
                gachaTotalCount
            FROM Gacha 
            JOIN GachaTranslate ON gachaId = gachaTranslateGachaId AND gachaTranslateJpFlag = ?
            WHERE gachaId = ?`;
        const [query_result_gacha_data] = await mysql_con.query(gacha_data_query, [1, gachaId]);

        let gachaData = query_result_gacha_data[0];

        if (gachaData) {
            const returnRateWithoutCeiling = gachaData.returnRate || 0;

            gachaData.returnRate = parseFloat((returnRateWithoutCeiling * 100).toFixed(1));

            if (gachaData.gachaStatus == 1) {
                gachaData.redisDataLength = await cluster.llen(`gacha:${ENVID}:${gachaId}:list`);
            }
        }

        if (gachaData?.gachaBuildStatus == 1) {
            response = { count: 0, records: [], data: gachaData }

            return getResponse(response, 200);
        }

        const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort, type = '' } = queryStringParameters || {};

        let where = 'WHERE gachaEmissionGachaId = ? ';

        if (filter) {
            const { condition = '', conditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, mapperKey);

            where = condition;
            parameter = [...parameter, ...conditionParameters];

            if (where) where += ' AND gachaEmissionGachaId = ?'
        }

        parameter = [...parameter, gachaId]

        let orderBy = commonFunctions1.convertToMySQLSort(sort, 'gachaEmissionOrder ASC', mapperKey);
        let ceilingOrderBy = commonFunctions1.convertToMySQLSort(sort, 'gachaEmissionLimitOrder ASC', mapperKey);

        if (type === 'ceilingAward') {
            const sql_count = `
            SELECT 
                COUNT(gachaEmissionId ) as total_rows
            FROM 
                GachaEmission
            LEFT OUTER JOIN 
                ItemTranslate AS GachaEmissionBonusItemTranslate ON gachaEmissionBonusItemId = GachaEmissionBonusItemTranslate.itemTranslateItemId AND GachaEmissionBonusItemTranslate.itemTranslateJpFlag = ?
            LEFT OUTER 
                JOIN Video ON gachaEmissionBonusVideoId = videoId
            ${where}
            AND gachaEmissionOrder = 0`;

            console.log('ceilingAward count sql ', sql_count)
            const [query_result_count] = await mysql_con.query(sql_count, [1, ...parameter]);

            const sql_data = `
            SELECT 
                gachaEmissionId,
                gachaEmissionOrder,
                gachaEmissionLimitOrder,
                GachaEmissionBonusItemTranslate.itemTranslateName AS gachaEmissionBonusItemName,
                gachaEmissionBonusItemPoint,
                videoName,
                gachaEmissionStatus
            FROM GachaEmission
            LEFT OUTER JOIN ItemTranslate AS GachaEmissionBonusItemTranslate ON gachaEmissionBonusItemId = GachaEmissionBonusItemTranslate.itemTranslateItemId AND GachaEmissionBonusItemTranslate.itemTranslateJpFlag = ?
            LEFT OUTER JOIN Video ON gachaEmissionBonusVideoId = videoId
            ${where}
            AND gachaEmissionOrder = 0
            ${ceilingOrderBy}
            LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('ceilingAward final sql_data ', sql_data);
            console.log('ceilingAward final parameter ', parameter);
            const [query_result_data] = await mysql_con.query(sql_data, [1, ...parameter]);

            response = {
                count: query_result_count[0]?.total_rows,
                records: query_result_data,
                data: gachaData
            }
        }
        else {
            const sql_count = `
            SELECT 
                COUNT(gachaEmissionId ) as total_rows
            FROM GachaEmission
            JOIN ItemTranslate ON gachaEmissionItemId = itemTranslateItemId AND itemTranslateJpFlag = ?
            JOIN GachaPrize ON gachaEmissionPrizeId = gachaPrizeId
            LEFT OUTER JOIN ItemTranslate AS GachaEmissionBonusItemTranslate ON gachaEmissionBonusItemId = GachaEmissionBonusItemTranslate.itemTranslateItemId AND GachaEmissionBonusItemTranslate.itemTranslateJpFlag = ?
            LEFT OUTER JOIN Video ON gachaEmissionVideoId = videoId
            ${where}`;
            // const sql_count = `
            // SELECT 
            //     COUNT(gachaEmissionId ) as total_rows
            // FROM GachaEmission
            // ${where}`;

            console.log('count sql ', sql_count)
            const [query_result_count] = await mysql_con.query(sql_count, [1, 1, ...parameter]);
            // const [query_result_count] = await mysql_con.query(sql_count, [...parameter]);

            const jump_page_query = `
            SELECT * FROM (
                SELECT 
                    *, 
                    @row_number := @row_number + 1 as offset 
                FROM (       
                    SELECT 
                        gachaEmissionId,
                        gachaEmissionOrder,
                        gachaEmissionStatus
                    FROM GachaEmission
                    JOIN ItemTranslate ON gachaEmissionItemId = itemTranslateItemId AND itemTranslateJpFlag = ?
                    JOIN GachaPrize ON gachaEmissionPrizeId = gachaPrizeId
                    LEFT OUTER JOIN ItemTranslate AS GachaEmissionBonusItemTranslate ON gachaEmissionBonusItemId = GachaEmissionBonusItemTranslate.itemTranslateItemId AND GachaEmissionBonusItemTranslate.itemTranslateJpFlag = ?
                    LEFT OUTER JOIN Video ON gachaEmissionVideoId = videoId
                    CROSS JOIN (SELECT @row_number := 0) r
                    ${where} 
                    ${orderBy}
                ) AS c
            ) AS c2 WHERE gachaEmissionStatus = 0 ORDER BY gachaEmissionOrder ASC LIMIT 0, 1`;

            console.log('sql unsuccess_emission_page_query ===>>', jump_page_query)
            const [unsuccess_emission_page_result] = await mysql_con.query(jump_page_query, [1, 1, ...parameter, 1, 1, ...parameter]);

            console.log('unsuccess_emission_page_result >>>>>>>>>>>>>>>>>---', unsuccess_emission_page_result)

            let jumpPageNo = 0;
            let smalestUnsuccessRecordId = 0;
            if (unsuccess_emission_page_result.length > 0 && unsuccess_emission_page_result[0].offset > 0 && Number(limit) > 0) {
                jumpPageNo = Math.ceil(unsuccess_emission_page_result[0].offset / Number(limit));
                smalestUnsuccessRecordId = unsuccess_emission_page_result[0].gachaEmissionId;
            }

            const sql_data = `
            SELECT 
                gachaEmissionId, 
                gachaEmissionOrder,
                GachaEmissionBonusItemTranslate.itemTranslateName AS gachaEmissionBonusItemName,
                gachaEmissionBonusItemPoint,
                gachaPrizeName,
                videoName,
                ItemTranslate.itemTranslateName AS gachaEmissionItemName,
                gachaEmissionItemPoint,
                gachaEmissionStatus
            FROM GachaEmission
            JOIN ItemTranslate ON gachaEmissionItemId = itemTranslateItemId AND itemTranslateJpFlag = ?
            JOIN GachaPrize ON gachaEmissionPrizeId = gachaPrizeId
            LEFT OUTER JOIN ItemTranslate AS GachaEmissionBonusItemTranslate ON gachaEmissionBonusItemId = GachaEmissionBonusItemTranslate.itemTranslateItemId AND GachaEmissionBonusItemTranslate.itemTranslateJpFlag = ?
            LEFT OUTER JOIN Video ON gachaEmissionVideoId = videoId
            ${where}
            ${orderBy}
            LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('final  sql_data ', sql_data);
            console.log('final  parameter ', parameter);
            const [query_result_data] = await mysql_con.query(sql_data, [1, 1, ...parameter]);

            let { gachaTotalCount, gachaRemainingCount } = gachaData || {}
            if (!gachaRemainingCount) gachaRemainingCount = 0;

            response = {
                count: query_result_count[0]?.total_rows,
                // count: gachaData.gachaTotalCount,
                records: query_result_data,
                data: gachaData,
                jumpPageNo,
            }
        }

        console.log('my response', response)

        return getResponse(response, 200);

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);

    } finally {
        if (mysql_con) await mysql_con.close();

        try {
            await cluster.disconnect();
        } catch (err) {
            console.log('Error occurred during disconnect cluster')
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