/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

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
    }
    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const {
        gachaTotalCount,
        gachaLoopFlag,
        gachaSinglePoint,
        gachaConosecutiveCount,
        gachaConosecutivePoint,
        gachaLimitOncePerDay,
        gachaLimitOnce,
        gachaLimitEveryonePerDay,
        gachaAllRestCount,
        gachaLimitCount,
        gachaLastOneFlag,
        gachaLuckyNumber1,
        gachaLuckyNumber1MatchFlag,
        gachaLuckyNumber2,
        gachaLuckyNumber2MatchFlag,
        gachaLuckyNumber3,
        gachaLuckyNumber3MatchFlag,
        gachaLuckyNumber4,
        gachaLuckyNumber4MatchFlag,
        gachaLuckyNumber5,
        gachaLuckyNumber5MatchFlag,
        gachaLuckyNumber6,
        gachaLuckyNumber6MatchFlag,
        gachaLuckyNumber7,
        gachaLuckyNumber7MatchFlag,
        gachaMemo,
        gachaPrizes = [],
        updatedBy = null
    } = JSON.parse(event.body);

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { pathParameters: { gachaId = 0 } } = event || {};

        if (gachaId) {
            await mysql_con.beginTransaction();

            const updatedAt = Math.floor(new Date().getTime() / 1000);

            //Update item
            let gacha_update_query = `UPDATE Gacha SET 
                gachaTotalCount = ?,
                gachaLoopFlag = ?,
                gachaSinglePoint = ?,
                gachaConosecutiveCount = ?,
                gachaConosecutivePoint = ?,
                gachaLimitOncePerDay = ?,
                gachaLimitOnce = ?,
                gachaLimitEveryonePerDay = ?,
                gachaAllRestCount = ?,
                gachaLimitCount = ?,
                gachaLastOneFlag = ?,
                gachaLuckyNumber1 = ?,
                gachaLuckyNumber1MatchFlag = ?,
                gachaLuckyNumber2 = ?,
                gachaLuckyNumber2MatchFlag = ?,
                gachaLuckyNumber3 = ?,
                gachaLuckyNumber3MatchFlag = ?,
                gachaLuckyNumber4 = ?,
                gachaLuckyNumber4MatchFlag = ?,
                gachaLuckyNumber5 = ?,
                gachaLuckyNumber5MatchFlag = ?,
                gachaLuckyNumber6 = ?,
                gachaLuckyNumber6MatchFlag = ?,
                gachaLuckyNumber7 = ?,
                gachaLuckyNumber7MatchFlag = ?,
                gachaMemo = ?,
                gachaUpdatedAt = ?,
                gachaUpdatedBy = ?
                WHERE gachaId  = ?`;

            const sql_param = [
                gachaTotalCount,
                gachaLoopFlag,
                gachaSinglePoint,
                gachaConosecutiveCount,
                gachaConosecutivePoint,
                gachaLimitOncePerDay,
                gachaLimitOnce,
                gachaLimitEveryonePerDay,
                gachaAllRestCount,
                gachaLimitCount,
                gachaLastOneFlag,
                gachaLuckyNumber1,
                gachaLuckyNumber1MatchFlag,
                gachaLuckyNumber2,
                gachaLuckyNumber2MatchFlag,
                gachaLuckyNumber3,
                gachaLuckyNumber3MatchFlag,
                gachaLuckyNumber4,
                gachaLuckyNumber4MatchFlag,
                gachaLuckyNumber5,
                gachaLuckyNumber5MatchFlag,
                gachaLuckyNumber6,
                gachaLuckyNumber6MatchFlag,
                gachaLuckyNumber7,
                gachaLuckyNumber7MatchFlag,
                gachaMemo,
                updatedAt,
                updatedBy,
                gachaId,
            ];

            console.log('my bind params ->>>>>', sql_param)
            await mysql_con.execute(gacha_update_query, sql_param);

            //Update GachaPrize
            if (Array.isArray(gachaPrizes)) {
                const gacha_prize_update_query = `UPDATE GachaPrize SET 
                    gachaPrizePoint = ?,
                    gachaPrizeEmissionsCount = ?,
                    gachaPrizeSetItem = ?,
                    gachaPrizeSetVideo = ?
                    WHERE gachaPrizeGachaId = ? AND gachaPrizeId = ?`;

                for (let gachaPrize of gachaPrizes) {
                    const { gachaPrizeId, gachaPrizePoint, gachaPrizeEmissionsCount, gachaPrizeSetItem, gachaPrizeSetVideo } = gachaPrize || {};

                    const sql_params = [
                        gachaPrizePoint,
                        gachaPrizeEmissionsCount,
                        gachaPrizeSetItem,
                        gachaPrizeSetVideo,
                        gachaId,
                        gachaPrizeId,
                    ];

                    await mysql_con.execute(gacha_prize_update_query, sql_params);
                }
            }

            await mysql_con.commit();

            // lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
            let invokeParams = {
                FunctionName: "SystemRedisGachaExport-" + process.env.ENV,
                InvocationType: "RequestResponse"
            };
            // invoke lambda
            let result = await lambda.invoke(invokeParams).promise();
            if (result.$response.error) throw (500, result.$response.error.message);

            response = {};

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        }
        else {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify('gachaId is missing in pathParameters.'),
            }
        }
    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
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