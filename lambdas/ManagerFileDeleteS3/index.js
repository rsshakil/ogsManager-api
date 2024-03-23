/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
process.env.TZ = 'Asia/Tokyo';
//const common = require('./commonFunctions/checkFilter')
/**
 * ManagerFileUploadS3.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    let logData = [];
    let logAccountId;

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
    let writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };
    console.log('jsonBody1', event.body);
    // let jsonBody =  await multipart.parse(event);
    console.log('body',JSON.parse(event.body));
    const {
        file_name,
        bucketName,
        distination_directory,
    } = JSON.parse(event.body);

    const createdAt = Math.floor(new Date().getTime() / 1000);
  
    let mysql_con;
    try {
        mysql_con = await mysql.createConnection(writeDbConfig);

        // let validProjectId;
        // if (event?.requestContext?.authorizer?.pid) {
        //     validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
        //     // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
        //     if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
        //         // failure log
        //         //await createLog(context, 'csvExportTemplate', 'create', 'failure', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
        //         return {
        //             statusCode: 403,
        //             headers: {
        //                 'Access-Control-Allow-Origin': '*',
        //                 'Access-Control-Allow-Headers': '*',
        //             },
        //             body: JSON.stringify("Unauthorized"),
        //         };
        //     }
        // }
        const params2 = {
            Bucket: bucketName,
            Key: distination_directory,
        };
        let deleteRes = await s3.deleteObject(params2).promise();
        console.log('deleteRes', deleteRes);
        if (!deleteRes) {
            console.log("failure file delete");
            // failure log
            // await createLog(context, 'csvImportTemplate', 'create', 'failure', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "no data"
                }),
            };
        }
        // construct the response
        let response = {
            success: 1
        };
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        // mysql_con.rollback();
        console.log(error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        };
    }
};