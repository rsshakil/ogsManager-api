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
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        //Retrive tag records
        // const video_tag_count_subquery = `SELECT COUNT(*) FROM VideoTagRelation WHERE videoTagRelationVideoTagId = videoTagId`;
        
        //videoTagUses count
        const video_tagUses_count_subquery = `SELECT COUNT(*) FROM GachaPrize WHERE JSON_CONTAINS(gachaPrizeSetVideo,CONCAT('"videoTag-',VideoTag.videoTagId,'"'),'$')`;

        const video_tag_count_subquery = `SELECT IF(COUNT(VideoTagRelation.videoTagRelationId) = 0, JSON_ARRAY(),JSON_ARRAYAGG(videoTagRelationVideoId)) FROM VideoTagRelation WHERE videoTagRelationVideoTagId = videoTagId`;

        const video_tag_records_query = `SELECT videoTagId, videoTagName, videoTagOrder, (${video_tag_count_subquery}) AS videoId, (${video_tagUses_count_subquery}) AS videoTagUsesCount FROM VideoTag ORDER BY videoTagOrder ASC`;
        const [video_tag_records] = await mysql_con.query(video_tag_records_query);

        const systemDataSql = `SELECT systemValue FROM SystemData WHERE systemKey = ? LIMIT 0, 1`;
        const [systemData] = await mysql_con.query(systemDataSql, ['systemVideoTagMemo']);

        const videoQuery = `SELECT videoId,videoName FROM Video`;
        const [videoData] = await mysql_con.query(videoQuery, []);

        response = {
            records: video_tag_records,
            tagMemo: systemData[0].systemValue,
            videoItems:videoData
        }

        console.log('my response', response)

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
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