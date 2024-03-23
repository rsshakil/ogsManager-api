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
        process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
        process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
        process.env.ENVID = dbinfo.ENVID;
    }

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let mysql_con;
    const data = JSON.parse(event.body) || [];

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        await mysql_con.beginTransaction();

        //Identify create/update/remove records
        const createRecords = data.changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 1);
        const updateRecords = data.changes.filter(x => x.type == 'update');
        const removeRecords = data.changes.filter(x => x.type == 'remove');

        //Insert
        if (createRecords.length > 0) {
            const insert_video_query = `INSERT INTO Video (videoName, videoPath) VALUES ?`;
            const parameter = createRecords.map(x => [x.data.videoName, x.data.videoPath]);
            console.log("insert parameter", parameter);

            await mysql_con.query(insert_video_query, [parameter]);
        }

        //Update
        if (updateRecords.length > 0) {
            for (const video of updateRecords) {
                const { data, key } = video || {};
                let update_video_query = 'UPDATE Video SET';
                const queryParams = [];

                if (data.videoName) {
                    update_video_query += ' videoName = ?,';
                    queryParams.push(data.videoName);
                }

                if (data.videoPath) {
                    update_video_query += ' videoPath = ?,';
                    queryParams.push(data.videoPath);
                }

                // Remove trailing comma 
                if (queryParams.length > 0) {
                    update_video_query = update_video_query.slice(0, -1); // Remove trailing comma
                    update_video_query += ' WHERE videoId = ?';
                    queryParams.push(key);

                    console.log("update data", data);
                    await mysql_con.execute(update_video_query, queryParams);
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const video_remove_query = `DELETE FROM Video WHERE videoId IN (?)`;
            const removeRecordIds = removeRecords.map(x => x.key);
            console.log("removeRecordIds", removeRecordIds);

            await mysql_con.query(video_remove_query, [removeRecordIds]);
        }

        await mysql_con.commit();

        return getResponse({ message: "Operation success" }, 200);

    } catch (error) {
        console.error("error:", error)
        if (mysql_con) await mysql_con.rollback();

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