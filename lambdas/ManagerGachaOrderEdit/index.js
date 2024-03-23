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

    let { gachaId: sourceGachaId, gachaOrder } = JSON.parse(event.body);

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        if (!sourceGachaId) return getResponse("The provided gachaIs is invalid", 507);

        await mysql_con.beginTransaction();

        const source_record_query = 'SELECT gachaId, gachaOrder FROM Gacha WHERE gachaId = ? LIMIT 0, 1';
        const [source_record_query_result] = await mysql_con.query(source_record_query, [sourceGachaId]);

        if (source_record_query_result.length == 0) return getResponse("Gacha record not found", 507);

        const { gachaOrder: sourceGachaOrder } = source_record_query_result[0] || {};

        let destinationGachaOrder = gachaOrder;

        if (sourceGachaOrder == destinationGachaOrder) return getResponse({ message: "As source order & destination order are same no need to update" }, 200);

        let destinationPositionRecord = await getDestinationPositionRecord(mysql_con, destinationGachaOrder);

        //If undefined thats means either the inputted order value not found or the order value is out of range. in that case we need to reassign the value
        if (!destinationPositionRecord) {
            const min_max_order_query = `SELECT  MIN(gachaOrder) AS minOrder, MAX(gachaOrder) AS maxOrder FROM Gacha`;
            const [min_max_order_query_result] = await mysql_con.query(min_max_order_query, []);
            const [{ minOrder, maxOrder }] = min_max_order_query_result || {};

            if (sourceGachaOrder < destinationGachaOrder) destinationGachaOrder = maxOrder;
            else if (sourceGachaOrder > destinationGachaOrder) destinationGachaOrder = minOrder;

            destinationPositionRecord = await getDestinationPositionRecord(mysql_con, destinationGachaOrder);
        }

        if (destinationPositionRecord !== undefined) {
            console.log('src order', sourceGachaOrder)
            console.log('dst order', destinationGachaOrder)

            const gachaIds = [];
            const gachaOrders = [];

            //shift records => bottom --> top
            if (sourceGachaOrder < destinationGachaOrder) {
                let shift_records_query = `SELECT gachaId, gachaOrder FROM Gacha WHERE (gachaOrder >= ? AND gachaOrder <= ?) ORDER BY gachaOrder ASC`;
                const [shift_records_query_result] = await mysql_con.query(shift_records_query, [sourceGachaOrder, destinationGachaOrder]);

                if (shift_records_query_result.length > 0) {
                    let lastOrder = sourceGachaOrder;

                    for (let i = 0; i < (shift_records_query_result.length - 1); i++) {
                        const newOrder = (sourceGachaOrder + i);
                        const row1 = shift_records_query_result[i + 1];
                        const { gachaId } = row1 || {};

                        gachaIds.push(gachaId);
                        gachaOrders.push(newOrder);

                        lastOrder = newOrder;
                    }

                    //Finally update source -> destination
                    gachaIds.push(sourceGachaId);
                    gachaOrders.push(lastOrder + 1);
                }
            }
            //shift records => top --> bottom
            else if (sourceGachaOrder > destinationGachaOrder) {
                let shift_records_query = `SELECT gachaId, gachaOrder FROM Gacha WHERE (gachaOrder <= ? AND gachaOrder >= ?) ORDER BY gachaOrder ASC`;
                const [shift_records_query_result] = await mysql_con.query(shift_records_query, [sourceGachaOrder, destinationGachaOrder]);

                // console.log('shift_records_query_result T -> B', shift_records_query_result)

                if (shift_records_query_result.length > 0) {
                    let newOrder = sourceGachaOrder;

                    for (let i = (shift_records_query_result.length - 1); i > 0; i--) {
                        const row1 = shift_records_query_result[i - 1];
                        const { gachaId } = row1 || {};

                        gachaIds.push(gachaId);
                        gachaOrders.push(newOrder);

                        newOrder--;
                    }

                    //Finally update source -> destination
                    gachaIds.push(sourceGachaId);
                    gachaOrders.push(newOrder > 1 ? newOrder-- : 1);
                }
            }


            if (gachaIds.length > 0) {
                const order_update_sql = `UPDATE Gacha SET
                gachaOrder = ELT(FIELD(gachaId, ${gachaIds}), ${gachaOrders})
                WHERE gachaId IN (${gachaIds})`;
                await mysql_con.execute(order_update_sql, []);
            }
        }

        await mysql_con.commit();

		// lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
		let invokeParams = {
			FunctionName: "SystemRedisGachaExport-" + process.env.ENV,
			InvocationType: "RequestResponse",
		};
		// invoke lambda
		let result = await lambda.invoke(invokeParams).promise();
		if (result.$response.error) throw (500, result.$response.error.message);

        response = { message: "operation success" };
        return getResponse(response, 200);

    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
        console.error("error:", error)
        return getResponse(error, 400);
    } finally {
        if (mysql_con) await mysql_con.close();
    }

    async function getDestinationPositionRecord(mysql_con, destinationOrderNo) {
        const destination_record_query = `Select * FROM Gacha WHERE gachaOrder = ? LIMIT 0, 1`;
        const [destination_record_query_result] = await mysql_con.query(destination_record_query, [destinationOrderNo]);

        return destination_record_query_result[0];
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