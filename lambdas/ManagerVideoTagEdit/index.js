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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const data = JSON.parse(event.body) || [];

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        await mysql_con.beginTransaction();

        //Identify create/update/remove records
        const createRecords = data.changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 0);
        const updateRecords = data.changes.filter(x => x.type == 'update');
        const removeRecords = data.changes.filter(x => x.type == 'remove');

        //Insert
        if (createRecords.length > 0) {
            const insert_tag_query = `INSERT INTO VideoTag SET videoTagName = ?`;
            const insert_videoTagRelation_query = `INSERT INTO VideoTagRelation (videoTagRelationVideoTagId,videoTagRelationVideoId) VALUES ?`;
            // const parameter = createRecords.map(x => [x.data.videoTagName]);
            for (const x of createRecords){
                console.log("insert create parameter", x);

                const [query_result, query_fields_videoTag] = await mysql_con.query(insert_tag_query, [x.data.videoTagName]);

                if(x.data?.videoId && x.data?.videoId.length>0){
                    const videoTagRelationparameter = x.data.videoId.map(videoId => [query_result.insertId,videoId]);
                    await mysql_con.query(insert_videoTagRelation_query, [videoTagRelationparameter]);
                }

            }
        }

        //Update
        if (updateRecords.length > 0) {
            for (const tag of updateRecords) {
                const { data, key } = tag || {};
                let update_tag_query = 'UPDATE VideoTag SET';
                const queryParams = [];

                if (data.videoTagName) {
                    update_tag_query += ' videoTagName = ?,';
                    queryParams.push(data.videoTagName);
                }

                if (data.videoTagOrder !== undefined && data.videoTagOrder !== null) {
                    update_tag_query += ' videoTagOrder = ?,';
                    queryParams.push(data.videoTagOrder);
                }

                // Remove trailing comma if videoTagName or videoTagOrder exists in data
                if (queryParams.length > 0) {
                    update_tag_query = update_tag_query.slice(0, -1); // Remove trailing comma
                    update_tag_query += ' WHERE videoTagId = ?';
                    queryParams.push(key);

                    console.log("update data", data);
                    console.log("queryParams data", queryParams);
                    await mysql_con.execute(update_tag_query, queryParams);
                }
                if(data.videoId){
                    const update_videoTagRelation_query = `INSERT INTO VideoTagRelation (videoTagRelationVideoTagId,videoTagRelationVideoId) VALUES ?`;

                    const videoRelationTagDelete = `DELETE FROM VideoTagRelation where videoTagRelationVideoTagId = ?`;

                    await mysql_con.execute(videoRelationTagDelete, [key]);

                    if(data.videoId.length>0){
                        const videoTagRelationparameter = data.videoId.map(videoId => [key,videoId]);
                        await mysql_con.query(update_videoTagRelation_query, [videoTagRelationparameter]);
                    }
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const tag_remove_query = `DELETE FROM VideoTag WHERE videoTagId IN (?)`;

            const tag_relation_remove_query = `DELETE FROM VideoTagRelation WHERE videoTagRelationVideoTagId IN (?)`;

            const removeRecordIds = removeRecords.map(x => x.key);
            console.log("removeRecordIds", removeRecordIds);

            await mysql_con.query(tag_remove_query, [removeRecordIds]);

            await mysql_con.query(tag_relation_remove_query, [removeRecordIds]);
        }

        //Memo
        const systemUpdateQuery = `UPDATE SystemData SET systemValue = ? WHERE systemKey = ?`;
        await mysql_con.execute(systemUpdateQuery, [data.tagMemo, 'systemVideoTagMemo']);

        await mysql_con.commit();

        response = {};

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
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