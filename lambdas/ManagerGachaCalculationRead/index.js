/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

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
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let mysql_con;
    let response = {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { pathParameters: { gachaId = 0 } } = event || {};

        if (!gachaId) {
            return getResponse({ message: 'gachaId is missing in pathParameters.' }, 507);
        }

        const calculation_subquery = `
        SELECT 
            JSON_OBJECT(
                'expectedNumberUsers', CASE WHEN (gachaStatus = 3 || gachaStatus = 4) THEN 0 ELSE (gachaTotalCount / gachaLimitCount) END,
                'totalConsumptionPoint',  CASE WHEN (gachaStatus = 3 || gachaStatus = 4) THEN 0 ELSE (gachaTotalCount * gachaSinglePoint) END,
                'totalRegularPoint', CASE WHEN (gachaStatus = 3 || gachaStatus = 4) THEN 0 ELSE SUM(gachaEmissionItemPoint) END,
                'totalBonusPoint', CASE WHEN (gachaStatus = 3 || gachaStatus = 4) THEN 0 ELSE SUM(CASE WHEN gachaPrizeType > 1 AND gachaPrizeType <= 9 THEN gachaEmissionBonusItemPoint ELSE 0 END) END,
                'totalCeilingPoint', CASE WHEN (gachaStatus = 3 || gachaStatus = 4) THEN 0 ELSE SUM(CASE WHEN gachaPrizeType = 1 THEN gachaEmissionBonusItemPoint ELSE 0 END) END
            )
        FROM GachaEmission
        LEFT OUTER JOIN GachaPrize ON gachaPrizeId = gachaEmissionBonusPrizeId
        WHERE gachaEmissionGachaId = gachaId
        GROUP BY gachaEmissionGachaId`;

        const gacha_calculation_query = `
        SELECT 
            (${calculation_subquery}) AS cal
        FROM Gacha
        WHERE gachaId = ?`;

        const [gacha_calculation_result_data] = await mysql_con.query(gacha_calculation_query, [gachaId]);

        console.log('my summary ---->', gacha_calculation_result_data)

        if (gacha_calculation_result_data.length > 0) {
            let { expectedNumberUsers = 0, totalConsumptionPoint = 0, totalRegularPoint = 0, totalBonusPoint = 0, totalCeilingPoint = 0 } = gacha_calculation_result_data[0]?.cal || {};

            expectedNumberUsers = Number(expectedNumberUsers);
            totalConsumptionPoint = Number(totalConsumptionPoint);
            totalRegularPoint = Number(totalRegularPoint);
            totalBonusPoint = Number(totalBonusPoint);
            totalCeilingPoint = Number(totalCeilingPoint);

            const totalRewardPointWithoutCeiling = (totalRegularPoint + totalBonusPoint);
            const totalRewardPointWithCeiling = (totalRegularPoint + totalBonusPoint + (totalCeilingPoint * expectedNumberUsers));

            let returnRateWithoutCeiling = 0;
            if (totalConsumptionPoint > 0) returnRateWithoutCeiling = parseFloat(((totalRewardPointWithoutCeiling / totalConsumptionPoint) * 100).toFixed(1));

            let returnRateWithCeiling = 0;
            if (totalConsumptionPoint > 0) returnRateWithCeiling = parseFloat(((totalRewardPointWithCeiling / totalConsumptionPoint) * 100).toFixed(1));

            response = {
                totalConsumptionPoint,
                totalRewardPointWithoutCeiling,
                totalRewardPointWithCeiling,
                returnRateWithoutCeiling,
                returnRateWithCeiling
            }
        }

        return getResponse(response, 200);

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);

    } finally {
        if (mysql_con) await mysql_con.close();
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