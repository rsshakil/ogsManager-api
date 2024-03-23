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
        charset: process.env.DBCHARSET,
        multipleStatements: true
    };

    let {
        gachaEmissionOrder: destinationOrder,
        gachaEmissionLimitOrder: ceilingDestinationOrder,
        gachaEmissionBonusItemPoint,
        gachaEmissionItemPoint,
    } = JSON.parse(event.body);

    let mysql_con;
    let response = {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { queryStringParameters: { gachaEmissionId: sourceGachaEmissionId, gachaEmissionExecuteFlag } = {}, pathParameters: { gachaId = 0 } = {} } = event || {};

        if (!gachaId > 0 || !sourceGachaEmissionId > 0 || !gachaEmissionExecuteFlag) {
            return getResponse({ message: 'Required parameters are missing in pathParameters/queryStringParameters.' }, 507);
        }

        await mysql_con.beginTransaction();
        const updatedAt = Math.floor(new Date().getTime() / 1000);

        //1 = 順番の変更/Change order
        if (gachaEmissionExecuteFlag == 1) {
            console.log('order change executing ----------->>>>');
            //Order value can be 1 ~ any valid positive integer
            //If order change to other order value then rest of order shift top-bottom/bottom-top
            //If new order value < 0 then change to min order value from current records. If new order value > out of range then change to max order value from current records.

            //S1: Check the new order value out of range or not found. Ex i have 1 ~ 100 order records. Now check the new value present in the range 1 ~ 100
            //S2: If out of range then set new order value. If newOrderValue < 0 then newOrderValue = 1, IF newOrderValue > 100 then newOrderValue = 100
            //S3: Find the newOrderValue's gachaEmissionId from DB.
            //S4: Now if want to change 1 with 5 (source order < destination order), need to shift(bottom->top) by 1 from 2 ~ 5 (N.B: During updating only right part (item pt, item, prize, video column value will change their position but the bonus item & bonus pt will not change their position & holding prev position))
            //S4: Now if want to change 5 with 1 (source order > destination order), need to shift(top -> bottom) by 1 from 1 ~ 4 (N.B: During updating only right part (item pt, item, prize, video column value will change their position but the bonus item & bonus pt will not change their position & holding prev position))

            //S1
            const source_record_query = 'SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND gachaEmissionId = ? LIMIT 0, 1';
            const [source_record_query_result] = await mysql_con.query(source_record_query, [gachaId, sourceGachaEmissionId]);
            const { gachaEmissionOrder: sourceGachaEmissionOrder } = source_record_query_result[0] || {};

            let destinationGachaEmissionOrder = destinationOrder;

            if (sourceGachaEmissionOrder == destinationGachaEmissionOrder) return getResponse({ message: "As source order & destination order are same no need to update" }, 200);

            let destinationPositionRecord = await getDestinationPositionRecord(mysql_con, gachaId, destinationGachaEmissionOrder);
            //If undefined thats means either the inputted order value not found or the order value is out of range. in that case we need to reassign the value
            if (!destinationPositionRecord) {
                const min_max_order_query = `SELECT  MIN(gachaEmissionOrder) AS minOrder, MAX(gachaEmissionOrder) AS maxOrder FROM GachaEmission Where gachaEmissionGachaId = ? `;
                const [min_max_order_query_result] = await mysql_con.query(min_max_order_query, [gachaId]);
                const [{ minOrder, maxOrder }] = min_max_order_query_result || {};

                if (sourceGachaEmissionOrder < destinationGachaEmissionOrder) destinationGachaEmissionOrder = maxOrder;
                else if (sourceGachaEmissionOrder > destinationGachaEmissionOrder) destinationGachaEmissionOrder = minOrder;

                destinationPositionRecord = await getDestinationPositionRecord(mysql_con, gachaId, destinationGachaEmissionOrder);
            }

            if (destinationPositionRecord !== undefined) {

                const {
                    gachaEmissionBonusItemId: destinationGachaEmissionBonusItemId,
                    gachaEmissionBonusItemPoint: destinationGachaEmissionBonusItemPoint,
                    gachaEmissionBonusVideoId: destinationGachaEmissionBonusVideoId,
                    gachaEmissionBonusPrizeId: destinationGachaEmissionBonusPrizeId,
                } = destinationPositionRecord || {}

                console.log('src order', sourceGachaEmissionOrder)
                console.log('dst order', destinationGachaEmissionOrder)

                let shift_records_query = `SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND (gachaEmissionOrder >= ? AND gachaEmissionOrder <= ?) ORDER BY gachaEmissionOrder ASC`;
                const [shift_records_query_result] = await mysql_con.query(shift_records_query, [gachaId, sourceGachaEmissionOrder, destinationGachaEmissionOrder]);
                console.log('my checking -----> shift records : ', shift_records_query_result)

                let shift_record_update__query = '';
                //S4
                if (sourceGachaEmissionOrder < destinationGachaEmissionOrder) {
                    let shift_records_query = `SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND (gachaEmissionOrder >= ? AND gachaEmissionOrder <= ?) ORDER BY gachaEmissionOrder ASC`;
                    const [shift_records_query_result] = await mysql_con.query(shift_records_query, [gachaId, sourceGachaEmissionOrder, destinationGachaEmissionOrder]);

                    if (shift_records_query_result.length > 0) {
                        let lastOrder = sourceGachaEmissionOrder;

                        for (let i = 0; i < (shift_records_query_result.length - 1); i++) {
                            const newOrder = (sourceGachaEmissionOrder + i);

                            const row = shift_records_query_result[i];
                            const row1 = shift_records_query_result[i + 1];

                            const { gachaEmissionBonusItemId, gachaEmissionBonusItemPoint, gachaEmissionBonusVideoId, gachaEmissionBonusPrizeId } = row || {};
                            const { gachaEmissionId } = row1 || {};

                            shift_record_update__query += `
                                 UPDATE GachaEmission SET 
                                 gachaEmissionOrder = '${newOrder}', 
                                 gachaEmissionBonusItemId = '${gachaEmissionBonusItemId}',
                                 gachaEmissionBonusItemPoint = '${gachaEmissionBonusItemPoint}',
                                 gachaEmissionBonusVideoId = '${gachaEmissionBonusVideoId}',
                                 gachaEmissionBonusPrizeId = '${gachaEmissionBonusPrizeId}'
                                 WHERE gachaEmissionId = '${gachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}'; `;

                            lastOrder = newOrder;
                        }

                        //Finally update source -> destination
                        shift_record_update__query += `
                                 UPDATE GachaEmission SET 
                                 gachaEmissionOrder = '${(lastOrder + 1)}', 
                                 gachaEmissionBonusItemId = '${destinationGachaEmissionBonusItemId}',
                                 gachaEmissionBonusItemPoint = '${destinationGachaEmissionBonusItemPoint}',
                                 gachaEmissionBonusVideoId = '${destinationGachaEmissionBonusVideoId}',
                                 gachaEmissionBonusPrizeId = '${destinationGachaEmissionBonusPrizeId}'
                                 WHERE gachaEmissionId = '${sourceGachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}'; `;
                    }
                }
                //S5
                else if (sourceGachaEmissionOrder > destinationGachaEmissionOrder) {
                    let shift_records_query = `SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND (gachaEmissionOrder <= ? AND gachaEmissionOrder >= ?) ORDER BY gachaEmissionOrder ASC`;
                    const [shift_records_query_result] = await mysql_con.query(shift_records_query, [gachaId, sourceGachaEmissionOrder, destinationGachaEmissionOrder]);

                    if (shift_records_query_result.length > 0) {
                        let newOrder = sourceGachaEmissionOrder;

                        for (let i = (shift_records_query_result.length - 1); i > 0; i--) {

                            const row = shift_records_query_result[i];
                            const row1 = shift_records_query_result[i - 1];

                            const { gachaEmissionBonusItemId, gachaEmissionBonusItemPoint, gachaEmissionBonusVideoId, gachaEmissionBonusPrizeId } = row || {};
                            const { gachaEmissionId } = row1 || {};

                            shift_record_update__query += `
                                 UPDATE GachaEmission SET 
                                 gachaEmissionOrder = '${newOrder}', 
                                 gachaEmissionBonusItemId = '${gachaEmissionBonusItemId}',
                                 gachaEmissionBonusItemPoint = '${gachaEmissionBonusItemPoint}',
                                 gachaEmissionBonusVideoId = '${gachaEmissionBonusVideoId}',
                                 gachaEmissionBonusPrizeId = '${gachaEmissionBonusPrizeId}'
                                 WHERE gachaEmissionId = '${gachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}'; `;

                            newOrder--;
                        }

                        //Finally update source -> destination
                        shift_record_update__query += `
                                 UPDATE GachaEmission SET 
                                 gachaEmissionOrder = '${newOrder > 1 ? newOrder-- : 1}', 
                                 gachaEmissionBonusItemId = '${destinationGachaEmissionBonusItemId}',
                                 gachaEmissionBonusItemPoint = '${destinationGachaEmissionBonusItemPoint}',
                                 gachaEmissionBonusVideoId = '${destinationGachaEmissionBonusVideoId}',
                                 gachaEmissionBonusPrizeId = '${destinationGachaEmissionBonusPrizeId}'
                                 WHERE gachaEmissionId = '${sourceGachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}'; `;
                    }
                }

                console.log('my checking --------------sql', shift_record_update__query)
                if (shift_record_update__query) {
                    await mysql_con.query(shift_record_update__query, []);
                }
            }
        }

        //2 = ポイントの変更/point change
        else if (gachaEmissionExecuteFlag == 2) {
            const sql_data = `SELECT * FROM GachaEmission WHERE gachaEmissionId = ? AND gachaEmissionGachaId = ? LIMIT 0, 1`;
            const [sql_result_data] = await mysql_con.query(sql_data, [sourceGachaEmissionId, gachaId]);

            if (sql_result_data.length > 0) {
                const { gachaEmissionItemPoint: currentGachaEmissionItemPoint, gachaEmissionBonusItemPoint: currentGachaEmissionBonusItemPoint } = sql_result_data[0] || {};

                //If point given <= 0 then set to 1
                let newPointValue = 0;
                let updateKeyColumn = '';

                if (gachaEmissionItemPoint !== undefined && currentGachaEmissionItemPoint != gachaEmissionItemPoint) {
                    newPointValue = gachaEmissionItemPoint;
                    updateKeyColumn = 'gachaEmissionItemPoint';
                }
                else if (gachaEmissionBonusItemPoint !== undefined && currentGachaEmissionBonusItemPoint != gachaEmissionBonusItemPoint) {
                    newPointValue = gachaEmissionBonusItemPoint;
                    updateKeyColumn = 'gachaEmissionBonusItemPoint';
                }

                if (updateKeyColumn) {
                    const point_update_query = `
                    UPDATE GachaEmission SET 
                    ${updateKeyColumn} = ?,
                    gachaEmissionUpdatedAt = ?
                    WHERE gachaEmissionId = ? AND gachaEmissionGachaId = ?`;

                    await mysql_con.execute(point_update_query, [newPointValue, updatedAt, sourceGachaEmissionId, gachaId]);
                }
            }
        }


        //3 = Gacha ceiling award change order
        else if (gachaEmissionExecuteFlag == 3) {
            console.log('Gacha ceiling award order change executing ----------->>>>');
            //S1
            const source_record_query = 'SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND gachaEmissionId = ? AND gachaEmissionOrder = 0 LIMIT 0, 1';
            const [source_record_query_result] = await mysql_con.query(source_record_query, [gachaId, sourceGachaEmissionId]);
            const { gachaEmissionLimitOrder: sourceGachaEmissionLimitOrder } = source_record_query_result[0] || {};

            let destinationGachaEmissionLimitOrder = ceilingDestinationOrder;

            if (sourceGachaEmissionLimitOrder == destinationGachaEmissionLimitOrder) return getResponse({ message: "As source order & destination order are same no need to update" }, 200);

            let destinationPositionRecord = await getCeilingDestinationPositionRecord(mysql_con, gachaId, destinationGachaEmissionLimitOrder);
            //If undefined thats means either the inputted order value not found or the order value is out of range. in that case we need to reassign the value
            if (!destinationPositionRecord) {
                const min_max_order_query = `SELECT  MIN(gachaEmissionLimitOrder) AS minOrder, MAX(gachaEmissionLimitOrder) AS maxOrder FROM GachaEmission Where gachaEmissionGachaId = ? AND gachaEmissionOrder = 0`;
                const [min_max_order_query_result] = await mysql_con.query(min_max_order_query, [gachaId]);
                const [{ minOrder, maxOrder }] = min_max_order_query_result || {};

                if (sourceGachaEmissionLimitOrder < destinationGachaEmissionLimitOrder) destinationGachaEmissionLimitOrder = maxOrder;
                else if (sourceGachaEmissionLimitOrder > destinationGachaEmissionLimitOrder) destinationGachaEmissionLimitOrder = minOrder;

                destinationPositionRecord = await getCeilingDestinationPositionRecord(mysql_con, gachaId, destinationGachaEmissionLimitOrder);
            }

            if (destinationPositionRecord !== undefined) {
                const {
                    gachaEmissionBonusItemId: destinationGachaEmissionBonusItemId,
                    gachaEmissionBonusItemPoint: destinationGachaEmissionBonusItemPoint,
                    gachaEmissionBonusVideoId: destinationGachaEmissionBonusVideoId,
                    gachaEmissionBonusPrizeId: destinationGachaEmissionBonusPrizeId,
                } = destinationPositionRecord || {}

                console.log('src order', sourceGachaEmissionLimitOrder)
                console.log('dst order', destinationGachaEmissionLimitOrder)

                let shift_records_query = `SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND (gachaEmissionLimitOrder >= ? AND gachaEmissionLimitOrder <= ?) AND gachaEmissionOrder = 0 ORDER BY gachaEmissionLimitOrder ASC`;
                const [shift_records_query_result] = await mysql_con.query(shift_records_query, [gachaId, sourceGachaEmissionLimitOrder, destinationGachaEmissionLimitOrder]);
                console.log('my checking -----> shift records : ', shift_records_query_result)

                let shift_record_update__query = '';
                //S4
                if (sourceGachaEmissionLimitOrder < destinationGachaEmissionLimitOrder) {
                    console.log('sourceGachaEmissionLimitOrder < destinationGachaEmissionLimitOrder', sourceGachaEmissionLimitOrder + ' < ' + destinationGachaEmissionLimitOrder);
                    let shift_records_query = `SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND (gachaEmissionLimitOrder >= ? AND gachaEmissionLimitOrder <= ?) AND gachaEmissionOrder = 0 ORDER BY gachaEmissionLimitOrder ASC`;
                    const [shift_records_query_result] = await mysql_con.query(shift_records_query, [gachaId, sourceGachaEmissionLimitOrder, destinationGachaEmissionLimitOrder]);
                    console.log('shift_records_query_result 1', shift_records_query_result);

                    if (shift_records_query_result.length > 0) {
                        let lastOrder = sourceGachaEmissionLimitOrder;

                        for (let i = 0; i < (shift_records_query_result.length - 1); i++) {
                            const newOrder = (sourceGachaEmissionLimitOrder + i);

                            const row = shift_records_query_result[i];
                            const row1 = shift_records_query_result[i + 1];

                            const { gachaEmissionBonusItemId, gachaEmissionBonusItemPoint, gachaEmissionBonusVideoId, gachaEmissionBonusPrizeId } = row || {};
                            const { gachaEmissionId } = row1 || {};

                            shift_record_update__query += `
                                    UPDATE GachaEmission SET 
                                    gachaEmissionLimitOrder = '${newOrder}'
                                    WHERE gachaEmissionId = '${gachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}' AND gachaEmissionOrder = 0; `;

                            lastOrder = newOrder;
                        }

                        //Finally update source -> destination
                        shift_record_update__query += `
                                UPDATE GachaEmission SET 
                                gachaEmissionLimitOrder = '${(lastOrder + 1)}'
                                WHERE gachaEmissionId = '${sourceGachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}' AND gachaEmissionOrder = 0; `;
                    }
                }
                //S5
                else if (sourceGachaEmissionLimitOrder > destinationGachaEmissionLimitOrder) {
                    console.log('sourceGachaEmissionLimitOrder > destinationGachaEmissionLimitOrder', sourceGachaEmissionLimitOrder + ' > ' + destinationGachaEmissionLimitOrder);
                    let shift_records_query = `SELECT * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND (gachaEmissionLimitOrder <= ? AND gachaEmissionLimitOrder >= ?) AND gachaEmissionOrder = 0 ORDER BY gachaEmissionLimitOrder ASC`;
                    const [shift_records_query_result] = await mysql_con.query(shift_records_query, [gachaId, sourceGachaEmissionLimitOrder, destinationGachaEmissionLimitOrder]);
                    console.log('shift_records_query_result 2', shift_records_query_result);

                    if (shift_records_query_result.length > 0) {
                        let newOrder = sourceGachaEmissionLimitOrder;

                        for (let i = (shift_records_query_result.length - 1); i > 0; i--) {

                            const row = shift_records_query_result[i];
                            const row1 = shift_records_query_result[i - 1];

                            const { gachaEmissionBonusItemId, gachaEmissionBonusItemPoint, gachaEmissionBonusVideoId, gachaEmissionBonusPrizeId } = row || {};
                            const { gachaEmissionId } = row1 || {};

                            shift_record_update__query += `
                                    UPDATE GachaEmission SET 
                                    gachaEmissionLimitOrder = '${newOrder}'
                                    WHERE gachaEmissionId = '${gachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}' AND gachaEmissionOrder = 0; `;

                            newOrder--;
                        }

                        //Finally update source -> destination
                        shift_record_update__query += `
                                UPDATE GachaEmission SET 
                                gachaEmissionLimitOrder = '${newOrder > 1 ? newOrder-- : 1}'
                                WHERE gachaEmissionId = '${sourceGachaEmissionId}' AND gachaEmissionGachaId = '${gachaId}' AND gachaEmissionOrder = 0; `;
                    }
                }

                console.log('my checking --------------sql', shift_record_update__query)
                if (shift_record_update__query) {
                    await mysql_con.query(shift_record_update__query, []);
                }
            }
        }

        await mysql_con.commit();

        return getResponse(response, 200);

    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
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


    async function getDestinationPositionRecord(mysql_con, gachaId, destinationOrderNo) {
        const destination_record_query = `Select * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND gachaEmissionOrder = ? LIMIT 0, 1`;
        const [destination_record_query_result] = await mysql_con.query(destination_record_query, [gachaId, destinationOrderNo]);

        return destination_record_query_result[0];
    }

    async function getCeilingDestinationPositionRecord(mysql_con, gachaId, destinationOrderNo) {
        const destination_record_query = `Select * FROM GachaEmission WHERE gachaEmissionGachaId = ? AND gachaEmissionLimitOrder = ? AND gachaEmissionOrder = 0 LIMIT 0, 1`;
        const [destination_record_query_result] = await mysql_con.query(destination_record_query, [gachaId, destinationOrderNo]);

        return destination_record_query_result[0];
    }
};