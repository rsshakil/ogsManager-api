/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

process.env.TZ = "Asia/Tokyo";

const sqs = new AWS.SQS();
const queueUrl2 = `https://sqs.ap-northeast-1.amazonaws.com/225702177590/InventorySQS-${process.env.ENV}.fifo`;
const queueUrl = `https://sqs.ap-northeast-1.amazonaws.com/225702177590/PointSQS-${process.env.ENV}.fifo`;

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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

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

    const {
        userCollectionStatus,
        userCollectionMemo
    } = JSON.parse(event.body);

    let mysql_con;
    let response = {};
    let parameter = [];
    console.log("event.",event);
    
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { pathParameters: { shippingId = 0 }, queryStringParameters: { actionType = 1 } } = event || {};
        console.log("actionType.",actionType);
        // return getResponse(response, 200);
        if (!shippingId) return getResponse({ message: 'shippingId is missing in pathParameters.' }, 507);

        await mysql_con.beginTransaction();

        const user_collection_sql = `SELECT * FROM UserCollection WHERE userCollectionId = ?`;
        const [user_collection_data] = await mysql_con.query(user_collection_sql, [shippingId]);

        if (user_collection_data.length == 0) return getResponse({ message: 'Not found!' }, 404)

        const { userCollectionItemId, userCollectionStatus: currentStatus, userCollectionUserId, userCollectionTransactionUUID } = user_collection_data[0] || {};

        const now = Math.floor(new Date().getTime() / 1000);
        if(actionType===1){
            //Update shipping from edit modal
            let item_update_query = `UPDATE UserCollection SET`;

            if (userCollectionStatus == 3) {
                item_update_query += ` userCollectionShippedAt = ?, `;
                parameter.push(now);
            }

            item_update_query += `
                userCollectionStatus = ?,
                userCollectionMemo = ?,
                userCollectionUpdatedAt = ?
                WHERE userCollectionId = ?
            `;

            parameter = [...parameter, userCollectionStatus, userCollectionMemo, now, shippingId];
            await mysql_con.execute(item_update_query, parameter);

            const shippingFlag = await updateRedisData(mysql_con, cluster, userCollectionStatus);
            response.shippingFlag = shippingFlag;

            let inventoryId;
            let pattern;
            //Shipped
            // 3 = 発送済み
            // 4 = その他
            // 6 = キャンセル
            if (userCollectionStatus == 3 || userCollectionStatus == 4 || userCollectionStatus == 6) {
                //Handle systemShippingReturnPoint
                // 2 = 発送申請中
                // 5 = 発送準備中

                //Check is there any collection remaining for shipment ?
                //If all are shipped except current collection then return 200pt(It depends on setting)
                const check_sql = `
                SELECT COUNT(*) AS row_count 
                FROM UserCollection 
                WHERE userCollectionUserId = ? AND userCollectionTransactionUUID = ? AND userCollectionId != ? AND (userCollectionStatus = 2 || userCollectionStatus = 5)`;
                const [check_result_data] = await mysql_con.query(check_sql, [userCollectionUserId, userCollectionTransactionUUID, shippingId]);

                if (Array.isArray(check_result_data) && check_result_data[0].row_count == 0) {
                    // すでにポイント変換した人がいるかどうかチェック
                    const check_sql2 = `SELECT userVariousValue FROM User WHERE userId = ?`;
                    const [check_result_data2] = await mysql_con.query(check_sql2, [userCollectionUserId]);
                    if (check_result_data2 && check_result_data2[0] && check_result_data2[0].userVariousValue >= 1) {
                        const subtraction_sql = `UPDATE User SET userVariousValue = userVariousValue - 1 WHERE userId = ?`;
                        const [check_result_data3] = await mysql_con.query(subtraction_sql, [userCollectionUserId]);
                    }
                    else {
                        //This condition prevent multiple shipment point return
                        if ([2, 5].includes(currentStatus)) {
                            const shippingReturnPoint = Number(await cluster.get("system:" + ENVID + ":srp"));
                            //SQS Processing
                            const params = {
                                MessageBody: JSON.stringify({ userId: userCollectionUserId, point: shippingReturnPoint, detailStatus: 9, executeAt: Math.floor(new Date().getTime() / 1000) }),
                                QueueUrl: queueUrl,
                                MessageGroupId: "POINTSQS_EXECUTE",
                                MessageDeduplicationId: uuidv4(),
                            };
                            await sqs.sendMessage(params).promise();
                            await cluster.incrby("user:" + ENVID + ":" + userCollectionUserId + ":pt", shippingReturnPoint);

                            console.log('shipment return point sqs executed point: ', shippingReturnPoint)
                        }
                    }
                }

                if (userCollectionStatus == 3) {
                    inventoryId = 6;
                }
                else if (userCollectionStatus == 4) {
                    inventoryId = 7;
                    pattern = (currentStatus == 3) ? 'SHIPPED_2_OTHER' : 'REQUEST_2_OTHER';
                }
                else if (userCollectionStatus == 6) {
                    inventoryId = 11;
                    pattern = (currentStatus == 3) ? 'SHIPPED_2_OTHER' : 'REQUEST_2_OTHER';
                }
            }
            //request -> other OR shipped -> other
            // else if (userCollectionStatus == 4 && (currentStatus == 2 || currentStatus == 3)) {
            //     inventoryId = 7;
            //     pattern = (currentStatus == 2) ? 'REQUEST_2_OTHER' : 'SHIPPED_2_OTHER';
            // }

            if (inventoryId) {
                // 在庫変動をSQSに
                const params2 = {
                    MessageBody: JSON.stringify({ itemId: [userCollectionItemId], inventoryId, pattern }),
                    QueueUrl: queueUrl2,
                    MessageGroupId: "INVENTORY_EXECUTE",
                    MessageDeduplicationId: uuidv4(),
                };
                await sqs.sendMessage(params2).promise();
            }
        }else{
            //update shippingStatus from page
            let item_update_query = `UPDATE UserCollection SET`;

            if (userCollectionStatus == 3) {
                item_update_query += ` userCollectionShippedAt = ?, `;
                parameter.push(now);
            }

            item_update_query += `
                userCollectionStatus = ?,
                userCollectionUpdatedAt = ?
                WHERE userCollectionId = ?
            `;

            parameter = [...parameter, userCollectionStatus, now, shippingId];
            await mysql_con.execute(item_update_query, parameter);

            const shippingFlag = await updateRedisData(mysql_con, cluster, userCollectionStatus);
            response.shippingFlag = shippingFlag;

            let inventoryId;
            let pattern;
            //Shipped
            // 3 = 発送済み
            // 4 = その他
            // 6 = キャンセル
            if (userCollectionStatus == 3 || userCollectionStatus == 4 || userCollectionStatus == 6) {
                //Handle systemShippingReturnPoint
                // 2 = 発送申請中
                // 5 = 発送準備中

                //Check is there any collection remaining for shipment ?
                //If all are shipped except current collection then return 200pt(It depends on setting)
                const check_sql = `
                SELECT COUNT(*) AS row_count 
                FROM UserCollection 
                WHERE userCollectionUserId = ? AND userCollectionTransactionUUID = ? AND userCollectionId != ? AND (userCollectionStatus = 2 || userCollectionStatus = 5)`;
                const [check_result_data] = await mysql_con.query(check_sql, [userCollectionUserId, userCollectionTransactionUUID, shippingId]);

                if (Array.isArray(check_result_data) && check_result_data[0].row_count == 0) {
                    // すでにポイント変換した人がいるかどうかチェック
                    const check_sql2 = `SELECT userVariousValue FROM User WHERE userId = ?`;
                    const [check_result_data2] = await mysql_con.query(check_sql2, [userCollectionUserId]);
                    if (check_result_data2 && check_result_data2[0] && check_result_data2[0].userVariousValue >= 1) {
                        const subtraction_sql = `UPDATE User SET userVariousValue = userVariousValue - 1 WHERE userId = ?`;
                        const [check_result_data3] = await mysql_con.query(subtraction_sql, [userCollectionUserId]);
                    }
                    else {
                        //This condition prevent multiple shipment point return
                        if ([2, 5].includes(currentStatus)) {
                            const shippingReturnPoint = Number(await cluster.get("system:" + ENVID + ":srp"));
                            //SQS Processing
                            const params = {
                                MessageBody: JSON.stringify({ userId: userCollectionUserId, point: shippingReturnPoint, detailStatus: 9, executeAt: Math.floor(new Date().getTime() / 1000) }),
                                QueueUrl: queueUrl,
                                MessageGroupId: "POINTSQS_EXECUTE",
                                MessageDeduplicationId: uuidv4(),
                            };
                            await sqs.sendMessage(params).promise();
                            await cluster.incrby("user:" + ENVID + ":" + userCollectionUserId + ":pt", shippingReturnPoint);

                            console.log('shipment return point sqs executed point: ', shippingReturnPoint)
                        }
                    }
                }

                if (userCollectionStatus == 3) {
                    inventoryId = 6;
                }
                else if (userCollectionStatus == 4) {
                    inventoryId = 7;
                    pattern = (currentStatus == 3) ? 'SHIPPED_2_OTHER' : 'REQUEST_2_OTHER';
                }
                else if (userCollectionStatus == 6) {
                    inventoryId = 11;
                    pattern = (currentStatus == 3) ? 'SHIPPED_2_OTHER' : 'REQUEST_2_OTHER';
                }
            }
            //request -> other OR shipped -> other
            // else if (userCollectionStatus == 4 && (currentStatus == 2 || currentStatus == 3)) {
            //     inventoryId = 7;
            //     pattern = (currentStatus == 2) ? 'REQUEST_2_OTHER' : 'SHIPPED_2_OTHER';
            // }

            if (inventoryId) {
                // 在庫変動をSQSに
                const params2 = {
                    MessageBody: JSON.stringify({ itemId: [userCollectionItemId], inventoryId, pattern }),
                    QueueUrl: queueUrl2,
                    MessageGroupId: "INVENTORY_EXECUTE",
                    MessageDeduplicationId: uuidv4(),
                };
                await sqs.sendMessage(params2).promise();
            }
            console.log("update from inner page");
        }

        await mysql_con.commit();

        return getResponse(response, 200);

    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
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


    async function updateRedisData(mysql_con, cluster, latestStatus) {
        let shippingFlag;

        if (latestStatus == 2) { //2=shipping awaiting
            shippingFlag = "true";
        }
        else {
            const shipping_await_records_count = `SELECT COUNT(userCollectionId) AS total_rows FROM UserCollection WHERE userCollectionStatus = ?`;
            const [shipping_await_records_count_result] = await mysql_con.query(shipping_await_records_count, [2]);

            if (shipping_await_records_count_result.length > 0 && shipping_await_records_count_result[0].total_rows > 0) {
                shippingFlag = "true";
            }
            else {
                shippingFlag = "false";
            }
        }

        await cluster.set(`shipping:${ENVID}:flag`, shippingFlag);

        return shippingFlag;
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