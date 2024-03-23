/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

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

    let {
        itemStockUnsetCount = 0,
        itemStockGachaCount = 0,
        itemStockCollectionCount = 0,
        itemStockShippingRequestCount = 0,
        itemStockShippedCount = 0,
        itemStockOtherCount = 0, 
        itemStockMemo = null,
        updatedBy = null
    } = JSON.parse(event.body);

    if (itemStockUnsetCount == 999999) itemStockUnsetCount = 1000000000;

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { pathParameters: { itemId = 0 } } = event || {};

        if (itemId) {
            await mysql_con.beginTransaction();

            const updatedAt = Math.floor(new Date().getTime() / 1000);

            // 構築処理をやっていないかチェックする
            let countBuild = `SELECT COUNT(*) AS cnt FROM Gacha WHERE gachaBuildStatus = 1`;
            const [query_result3] = await mysql_con.execute(countBuild, []);
            if (query_result3[0].cnt == 0) {
                //Update item
                let itemstock_update_query = `UPDATE ItemStock SET 
                    itemStockUnsetCount = ?,
                    itemStockMemo = ?
                    WHERE itemStockItemId = ?`;
                const sql_param = [
                    itemStockUnsetCount,
                    itemStockMemo,
                    itemId,
                ];
                const [query_result] = await mysql_con.execute(itemstock_update_query, sql_param);
                // itemの更新日時も更新する
                let itemQuery = `
                    UPDATE Item SET itemUpdatedAt = ? WHERE itemId = ?
                `;
                let itemUpdatedAt = Math.floor(new Date().getTime() / 1000);
                const sql_param2 = [
                    itemUpdatedAt,
                    itemId,
                ];
                const [query_result2] = await mysql_con.execute(itemQuery, sql_param2);

                await mysql_con.commit();

                response = {
                    records: query_result[0]
                };
            }
            else {
                throw (400, "現在ビルド中のため在庫更新ができません。");
            }

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
                body: JSON.stringify('itemId is missing in pathParameters.'),
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