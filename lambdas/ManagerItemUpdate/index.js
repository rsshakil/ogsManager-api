/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
const BUCKET = 'itemimage-ogs-'+ process.env.ENV
const tmpDir = 'tmp/';
const redis = require('ioredis');

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
        process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
        process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
        process.env.ENVID = dbinfo.ENVID;
    }

    // Database info
    const ENVID = process.env.ENVID;
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    const redisConfig = [
        {host: process.env.REDISPOINT1, port: 6379},
        {host: process.env.REDISPOINT2, port: 6379}
    ];

    const {
        itemStatus,
        itemImagePath1,
        itemImagePath2,
        itemImagePath3,
        itemShippingFlag,
        itemCategoryId,
        itemAttribute1,
        itemAttribute2,
        itemAttribute3,
        itemAttribute4,
        itemAttribute5,
        itemAttribute6,
        itemAttribute7,
        itemAttribute8,
        itemMemo,
        itemTags = [],
        itemTranslates = [],
        updatedBy = null
    } = JSON.parse(event.body);

    let mysql_con;
    const cluster = new redis.Cluster(
        redisConfig, 
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: {tls: true}        
        }
    );
    let response;
    //getFileKeyFromSrc
    const getFileKeyFromSrc = async (imageSrc) => { 
        // return imageSrc ? imageSrc.split("/").pop() : '';
        const tempDte = Math.floor(new Date().getTime() / 1000);
        if (imageSrc) {
            let imgInfo = imageSrc.split("/");
            console.log('imgInfo',imgInfo);
            let oldFileName = imgInfo[imgInfo.length - 1];
            let dirName = imgInfo[imgInfo.length - 2];  
            let fileExt = oldFileName.split(".");
            let orgFName = fileExt[0];
            if (orgFName.includes("-")) { 
                orgFName = orgFName.split("-")[0];
            }
            let newFileName = `${orgFName}-${tempDte}.${fileExt[1]}`;
            
            return {
                oldFileName:oldFileName,
                newFileName:newFileName,
                dirName:dirName,
            }
        }
        return false;
    }
    //moveObject
    const moveObejectFile = async (sourceKey, destinationKey,dir='tmp') => {
        const params = {
            Bucket: BUCKET,
            CopySource: `${BUCKET}/${sourceKey}`,
            Key: destinationKey,
        };
        const params2 = {
            Bucket: BUCKET,
            Key: sourceKey,
        };
        console.log("params", params);
        console.log("params2", params2);

        let copyRes = await s3.copyObject(params).promise();
        if (dir=='tmp') { 
            await s3.deleteObject(params2).promise();
        }
        
        console.log('copyRes', copyRes);
        return copyRes;
    }
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { pathParameters: { itemId = 0 } } = event || {};

        if (itemId) {
            await mysql_con.beginTransaction();
            let prevSql = 'select itemUUID, itemImagePath1,itemImagePath2,itemImagePath3,itemCategoryId from Item where itemId = ?';
            const [previousResult,previousField] = await mysql_con.query(prevSql, [itemId]);
            console.log('previousResult',previousResult[0]);
            let itemUUID = previousResult[0].itemUUID;
            let imagePath1 = itemImagePath1;
            let imagePath2 = itemImagePath2;
            let imagePath3 = itemImagePath3;
     
            if ((itemImagePath1!=previousResult[0].itemImagePath1) || (itemCategoryId!=previousResult[0].itemCategoryId)) { 
                let fileInfo = await getFileKeyFromSrc(itemImagePath1);
                if (fileInfo) { 
                    let sourceKey = `${fileInfo?.dirName}/${fileInfo?.oldFileName}`;
                    let destinationKey = `${itemCategoryId}/${fileInfo?.newFileName}`;
                    await moveObejectFile(sourceKey, destinationKey,fileInfo?.dirName);
                    let imageUrl = itemImagePath1.split(`/${fileInfo?.dirName}/`)[0];
                    imagePath1 = `${imageUrl}/${destinationKey}`;
                }
            }
            if ((itemImagePath2!=previousResult[0].itemImagePath2) || (itemCategoryId!=previousResult[0].itemCategoryId)) { 
                let fileInfo = await getFileKeyFromSrc(itemImagePath2);
                if (fileInfo) {
                    let sourceKey = `${fileInfo?.dirName}/${fileInfo?.oldFileName}`;
                    let destinationKey = `${itemCategoryId}/${fileInfo?.newFileName}`;
                    await moveObejectFile(sourceKey, destinationKey,fileInfo?.dirName);
                    let imageUrl = itemImagePath2.split(`/${fileInfo?.dirName}/`)[0];
                    imagePath2 = `${imageUrl}/${destinationKey}`;
                }
            }
            if ((itemImagePath3!=previousResult[0].itemImagePath3) || (itemCategoryId!=previousResult[0].itemCategoryId)) { 
                let fileInfo = await getFileKeyFromSrc(itemImagePath3);
                if (fileInfo) {
                    let sourceKey = `${fileInfo?.dirName}/${fileInfo?.oldFileName}`;
                    let destinationKey = `${itemCategoryId}/${fileInfo?.newFileName}`;
                    await moveObejectFile(sourceKey, destinationKey,fileInfo?.dirName);
                    let imageUrl = itemImagePath3.split(`/${fileInfo?.dirName}/`)[0];
                    imagePath3 = `${imageUrl}/${destinationKey}`;
                }
            }
            const updatedAt = Math.floor(new Date().getTime() / 1000);

            //Update item
            let item_update_query = `UPDATE Item SET 
                itemStatus = ?,
                itemImagePath1 = ?,
                itemImagePath2 = ?,
                itemImagePath3 = ?,
                itemShippingFlag = ?,
                itemCategoryId = ?,
                itemAttribute1 = ?,
                itemAttribute2 = ?,
                itemAttribute3 = ?,
                itemAttribute4 = ?,
                itemAttribute5 = ?,
                itemAttribute6 = ?,
                itemAttribute7 = ?,
                itemAttribute8 = ?,
                itemMemo = ?,
                itemUpdatedAt = ?,
                itemUpdatedBy = ?
                WHERE itemId = ?
            `;

            const sql_param = [
                itemStatus,
                imagePath1,
                imagePath2,
                imagePath3,
                itemShippingFlag,
                itemCategoryId,
                itemAttribute1,
                itemAttribute2,
                itemAttribute3,
                itemAttribute4,
                itemAttribute5,
                itemAttribute6,
                itemAttribute7,
                itemAttribute8,
                itemMemo,
                updatedAt,
                updatedBy,
                itemId,
            ];
            const [query_result] = await mysql_con.execute(item_update_query, sql_param);

            //Update itemTags
            const remove_item_tag_query = `DELETE FROM ItemTag WHERE itemTagItemId = ?`;
            await mysql_con.query(remove_item_tag_query, [itemId]);

            if (Array.isArray(itemTags) && itemTags.length > 0) {
                const item_tag_query = 'INSERT INTO ItemTag (itemTagItemId, itemTagTagId) VALUES ?';
                const item_tag_sql_param = itemTags.map(tagId => [itemId, tagId]);
                await mysql_con.query(item_tag_query, [item_tag_sql_param]);
            }

            //Update ItemTranslate
            const remove_item_translate_query = `DELETE FROM ItemTranslate WHERE itemTranslateItemId = ?`;
            await mysql_con.query(remove_item_translate_query, [itemId]);

            if (Array.isArray(itemTranslates) && itemTranslates.length > 0) {
                const item_translate_query = 'INSERT INTO ItemTranslate (itemTranslateItemId, itemTranslateTranslateId, itemTranslateName, itemTranslateDescription1, itemTranslateDescription2, itemTranslateDescription3, itemTranslateJpFlag) VALUES ?';
                const item_translate_sql_param = itemTranslates.map(x => {
                    const { itemTranslateTranslateId, itemTranslateName = '', itemTranslateDescription1 = '', itemTranslateDescription2 = '', itemTranslateDescription3 = '', itemTranslateJpFlag = 0 } = x || {};

                    return [
                        itemId,
                        itemTranslateTranslateId,
                        itemTranslateName ?? '',
                        itemTranslateDescription1 ?? '',
                        itemTranslateDescription2 ?? '',
                        itemTranslateDescription3 ?? '',
                        itemTranslateJpFlag ?? 0
                    ];
                });

                await mysql_con.query(item_translate_query, [item_translate_sql_param]);
            }

            await mysql_con.commit();

            const pipeline = cluster.pipeline();
            for (let i = 0; i < itemTranslates.length; i++) {
                const { itemTranslateTranslateId, itemTranslateName = '', itemTranslateDescription1 = '', itemTranslateDescription2 = '', itemTranslateDescription3 = '', itemTranslateJpFlag = 0 } = itemTranslates[i] || {};
                pipeline.del("item:" + ENVID + ":" + itemId + ":" + itemTranslateTranslateId + ":info");
                let itemJson = {
                    itemUUID:           itemUUID,
                    itemImagePath1:     imagePath1,
                    itemImagePath2:     imagePath2,
                    itemImagePath3:     imagePath3,
                    itemShippingFlag:   itemShippingFlag,
                    itemName:           itemTranslateName,
                    itemDescription1:   itemTranslateDescription1,
                    itemDescription2:   itemTranslateDescription2,
                    itemAttribute1:     itemAttribute1,
                    itemAttribute2:     itemAttribute2,
                    itemAttribute3:     itemAttribute3,
                    itemAttribute4:     itemAttribute4,
                    itemAttribute5:     itemAttribute5,
                    itemAttribute6:     itemAttribute6,
                    itemAttribute7:     itemAttribute7,
                    itemAttribute8:     itemAttribute8
                };
                pipeline.set("item:" + ENVID + ":" + itemId + ":" + itemTranslateTranslateId + ":info", JSON.stringify(itemJson));
            }
            await pipeline.exec();

            response = {
                records: query_result[0]
            };

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