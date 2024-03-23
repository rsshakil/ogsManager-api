/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');

process.env.TZ = 'Asia/Tokyo';

/**
 * ManagerFileUploadS3.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {
    console.log("Event data:", event);

    const { chunk } = event.body;

    const totalChunk = event.headers['total-chunk'];
    const bucketName = event.headers['bucket-name'];
    const fileName = event.headers['file-name'];
    const fileExtension = event.headers['file-extension'];
    const key = event.headers['key'];
    const offset = event.headers['offset'];
    const AllowMultipart = event.headers['allowmultipart'];

    const temFileName = `/tmp/${key}.${fileExtension}`;

    const chunkFileName = `${key}-${offset}.${fileExtension}`;
    const chunkFilePrefix = `Temp/${key}/`;

    try {

        if (AllowMultipart == true) {
            console.log('AllowMultipart is true >>>>>>>>>>>>>>>>>')
        }

        console.log('upload process start------------->bucketName', bucketName)

        // const chunk = Buffer.from(file, 'base64');
        await storeChunkFile(chunk);

        const data = await s3.listObjectsV2({ Bucket: bucketName, Prefix: chunkFilePrefix }).promise();
        const chunkFiles = data.Contents.filter(obj => !obj.Key.endsWith('/'));

        console.log('total chunkFiles len------>', chunkFiles.length)

        if (chunkFiles.length == totalChunk) {
            console.log('start merging>>>>>>>>>>>>>>>>>>>>')

            const partsList = [];
            chunkFiles.forEach((item) => {
                partsList.push(item.Key);
            });

            // Sort the parts by their index in the file name
            partsList.sort((a, b) => {
                const indexA = parseInt(a.split("-")[1]);
                const indexB = parseInt(b.split("-")[1]);

                return indexA - indexB;
            });

            console.log('partsList sorted ->>>>>>>>>>>>>', partsList)

            // Download each part and append it to the final merged file
            const mergedFileStream = fs.createWriteStream(temFileName);
            for (const part of partsList) {
                const partParams = { Bucket: bucketName, Key: part };
                const partData = await s3.getObject(partParams).promise();

                mergedFileStream.write(partData.Body);
            }
            mergedFileStream.end();

            console.log('parts combine done')

            const uploadParams = {
                Bucket: bucketName,
                Key: fileName,
                Body: fs.createReadStream(temFileName)
            };
            const result = await s3.upload(uploadParams).promise();

            await executeCleanupProcess();

            return getResponse({ message: 'Chunk received successfully', data: result }, 200);
        }

        return getResponse({ message: 'Chunk received successfully' }, 200);

    } catch (error) {
        console.log('error occurred:::----->', error);

        await executeCleanupProcess();

        return getResponse(error, 400);
    }

    async function checkAndCreateFolder() {
        try {
            const params = { Bucket: bucketName, Key: chunkFilePrefix };
            await s3.headObject(params).promise();
            console.log('Folder already exists in S3');

        } catch (error) {
            if (error.code === 'NotFound') {
                await s3.putObject({ Bucket: bucketName, Key: chunkFilePrefix }).promise();
                console.log('Folder created in S3');
            } else {
                console.error('Error checking or creating folder:', error);
            }
        }
    }


    async function storeChunkFile(file) {
        await checkAndCreateFolder();

        const params = {
            Bucket: bucketName,
            Key: chunkFilePrefix + chunkFileName,
            Body: file,
            ContentType: 'video/mp4',
        };

        return await s3.upload(params).promise();
    }

    async function executeCleanupProcess() {
        console.log('executeCleanupProcess ------------ start')

        //Remove temporary file from tmp directory
        fs.unlinkSync(temFileName);

        //Remove chunk files from s3
        const listParams = {
            Bucket: bucketName,
            Prefix: chunkFilePrefix
        };

        try {
            const { Contents } = await s3.listObjectsV2(listParams).promise();

            if (Contents.length === 0) {
                console.log('Folder is already empty.');
                return;
            }

            const deleteParams = {
                Bucket: bucketName,
                Delete: { Objects: [] },
            };

            Contents.forEach(({ Key }) => {
                deleteParams.Delete.Objects.push({ Key });
            });

            await s3.deleteObjects(deleteParams).promise();
            console.log('Objects inside the folder deleted successfully.');

            // Delete the folder itself
            const deleteFolderParams = {
                Bucket: bucketName,
                Key: chunkFilePrefix,
            };

            await s3.deleteObject(deleteFolderParams).promise();

            console.log('Folder deleted successfully.');

        } catch (error) {
            console.log('err occur in clean up process', error);
        }
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