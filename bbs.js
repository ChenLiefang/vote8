const express = require('express')
const open = require('open')
const cookieParser = require('cookie-parser')
const cors = require('cors')
const path = require('path')
const multer = require('multer')
const svgCaptcha = require('svg-captcha');
const WebSocket = require('ws')
const http = require('http')
const https = require('https')
const fs = require('fs')
const fsp = require('fs').promises

const _ = require('lodash')

const app = express()

const uploader = multer({ dest: __dirname + '/uploads/' })

// const port = 8081

// const server = http.createServer(app) //express返回的app就是用来传给createServer的
const server = http.createServer((req, res) => {
	res.writeHead(302, { Location: `https://${req.headers.host}${req.url}` });
	res.end();
}); //*跳转到https

server.listen(8081)


const servers = https.createServer(
    {key: fs.readFileSync('/root/.acme.sh/vote.aijj.xyz/vote.aijj.xyz.key'),
    cert: fs.readFileSync('/root/.acme.sh/vote.aijj.xyz/vote.aijj.xyz.cer'),
    },
    app
);
// servers.on('request',app)

const wss = new WebSocket.Server({server:servers})

//投票id到订阅这个投票信息更新的websocke的映射 
var voteIdMapWs ={}

wss.on('connection',async(ws, req)=>{
    var voteId = req.url.split('/').slice(-1)[0]
    console.log('将会把',voteId,'的实时信息发送到客户端')
//如果投票时间过期，将关闭这个页面
    var voteInfo = await db.get('SELECT rowid AS id, * FROM votes  WHERE id = ?',voteId)
    if(Date.now() > new Date(voteInfo.deadline).getTime()){
        ws.close()
    }
    if(voteId in voteIdMapWs ){
        voteIdMapWs[voteId].push(ws)

    }else{
        voteIdMapWs[voteId]=[ws]
    }
    ws.on('close',()=>{
        voteIdMapWs[voteId]= voteIdMapWs[voteId].filter(it =>it !== ws)
    })
})
let db
const dbPromise = require('./bbs-db.js')
const e = require('express')
    // const {  delete } = require('./bbs-api-router')
dbPromise.then(value => {
    db = value
})



app.locals.pretty = true //美化页面



//解决跨域问题
app.use(cors({
    maxAge: 86400,
    origin: 'true',
    credentials: true,
}))

app.use((req, res, next) => {
    console.log(req.method, req.url)
    next()
})
// app.use((req,res,next)=>{
//     req.on('data',data=>{
//         console.log(data.toString())
//     })
// })
app.use(express.static(__dirname + '/build'));
app.use(express.static(__dirname + '/static'))
app.use('/uploads', express.static(__dirname + '/uploads'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser('swdwew'))

//验证码 session 中间键 
var sessionStore = Object.create(null) 

app.use(function sessionMW(req, res, next) {
    if (req.cookies.sessionId) {
        req.session = sessionStore[req.cookies.sessionId]
        if (!req.session) {
            req.session = sessionStore[req.cookies.sessionId] = {}
        }
    } else {
        let id = Math.random().toString(16).slice(2)
        req.session = sessionStore[id] = {}
        res.cookie('sessionId', id, {
            maxAge: 86400000,
        })
    }
    next()
})

app.use(async(req, res, next) => {
        console.log(req.cookies, req.signedCookies)
            //从签名的cookie中找出该用户的信息，并挂在req对象上以供于后续的中间键访问
            //user是一个视图，自带id    
        if (req.signedCookies.user) {
            req.user = await db.get('SELECT * FROM user WHERE name =?', req.signedCookies.user)
        }
        next()
    })
    //创建投票
app.post('/vote', async(req, res, next) => {
        if (req.user) {
            /**
             * {
             *   title,
             *   desc,
             *   options:['foo','bar'],
             *   deadline,
             *   anoymous,
             *   isMultiple
             * }
             */
            var voteInfo = req.body
            await db.run(
                'INSERT INTO votes VALUES(?,?,?,?,?,?,?)', 
                [voteInfo.title, voteInfo.desc, req.user.id, voteInfo.deadline,
                    voteInfo.anoymous, new Date().toISOString(), voteInfo.isMultiple
                ]
            )
            //按照id倒序排列，并且选择第一个
            var vote = await db.get('SELECT rowid AS id , * FROM votes ORDER BY id DESC LIMIT 1')
            for (var option of voteInfo.options){
                await db.run(
                    'INSERT INTO options VALUES (?, ?, ?)',
                [vote.id, option,0]
                )
            }
            res.json({
                voteId: vote.id
            })
        } else {
            res.status(401).json({
                code: -1,
                msg: '未登录无法创建投票'
            })
        }

    })
//获取投票信息
app.get('/vote/:id',async(req, res,next)=>{
    var id = req.params.id
    var vote = await db.get('SELECT rowid AS id,* FROM votes WHERE id = ?',id)
    var options = await db.all('SELECT rowid AS id,* FROM options WHERE voteId = ?',id)
    //连表查询
    console.log('options:' , options)
    
    var votings = await db.all('SELECT votings.rowid As id,* FROM votings JOIN user ON userId = user.id WHERE voteId=?' ,id)
    vote.options = options
    vote.votings = votings
    res.json(vote)
})
app.delete('/vote/:id',async(req, res,next)=>{
    var id = req.params.id
    
    await db.run('DELETE FROM votes WHERE rowid = ?', id)// delete vote
    await db.run('delete from options where voteId = ?',id)// delete options for this vote 
  
    var vote = await db.get('SELECT rowid As id,* FROM votes WHERE id = ?',id)
    console.log(vote)
  
    var options = await db.all('SELECT rowid As id,* FROM options WHERE voteId = ?',id)
    //连表查询
    console.log(options)
    var votings = await db.all('SELECT votings.rowid As id,* FROM votings JOIN user ON userId = user.id WHERE voteId=?' ,id)
    console.log(votings)
    vote.options = options
    vote.votings = votings
    console.log(vote)
    res.json(vote)
   
})
app.get('/myvotes',async(req,res,next)=>{
    if(!req.user){
        res.status(401).json({
            code:-1,
            msg:'用户未登录'
        })
        return
    }
    var myVotes = await db.all('SELECT rowid AS id , * FROM votes WHERE userId=?' ,req.user.id)
    res.json(myVotes)
})

//用户对某个选项发起的投票
app.post('/voteup/:voteId',async(req, res,next)=>{
    /**
     * voteId:1
     * options:3
     */
    var body = req.body
    var voteId = req.params.voteId
    var vote = await db.get('SELECT rowid AS id,* FROM votes WHERE id = ?',voteId)

    if(Date.now() > new Date(vote.deadline).getTime()){
        res.status(401).end({
            code:-1,
            msg:'该问题已过截止日期，不能在投票'
        })
        return
    }
    if(!vote.isMultiple){//单选
        //删除之前可能投的一票
        await db.run('DELETE FROM votings WHERE userId = ? AND voteId = ?',req.user.id,voteId)
        //增加新的一票
        await db.run('INSERT INTO votings VALUES(?, ?, ? )',[voteId,body.optionId,req.user.id])
        res.end()
    }else{ //多选
        //如果是同样的选项被同一个用户再次发过来
        await db.run('DELETE FROM votings WHERE voteId = ? AND optionId = ? AND userId = ? ',[voteId,body.optionId,req.user.id])
        if(!req.body.isVoteDown){ //多选情况下再次点击即可取消选择
            await db.run('INSERT INTO votings VALUES(?, ?, ? )',[voteId,body.optionId,req.user.id])
        }
        res.end()
    }
   
    //即使频繁调用也是两秒钟运行一次
    broadcast(voteId)
})

var broadcast=_.throttle(async function broadcast(voteId){
    var Websockets = voteIdMapWs[voteId] || []
    var votings = await db.all('SELECT votings.rowid As id,* FROM votings JOIN user ON userId = user.id WHERE voteId=?' ,voteId)
    for( var ws of Websockets){
        ws.send(JSON.stringify(votings))
    }
},1000,{ leading: false})

    //注册页面
app.route('/register')
    //头像上传
    .post(uploader.single('avatar'), async(req, res, next) => {
        var user = req.body
        var file = req.file
        
        console.log('收到注册请求', user,file)
        

        var targetName = file.path + '-' + file.originalname
        await fsp.rename(file.path, targetName)
        var avatarOnLineUrl = '/uploads/' + path.basename(targetName)


        try {
            await db.run(`INSERT INTO users VALUES(?,?,?,?)`, [user.name, user.password, user.email, avatarOnLineUrl])
                // res.redirect('/login')
            res.json({
                code:0,
                msg: '注册成功',
               
            })
        } catch (e) {
            res.status(400).json({
                msg: '注册失败' + e.toString(),
                code: -1 
            })
        }
    })
    //username-conflict-check?name=lily
    //用户名冲突检测
app.get('/username-conflict-check', async(req, res, next) => {
        var user = await db.get('SELECT  * FROM users WHERE name = ? ', req.query.name)
        if (user) {
            res.json({
                isOk: false,
                msg: '用户名已经被占用'
            })
        } else {
            res.json({
                isOk: true,
                msg: '用户名可用'
            })
        }

     

    })

  
    
    //获取验证码图片
app.get('/captcha', function(req, res) {
    var captcha = svgCaptcha.create();
    req.session.captcha = captcha.text;

    res.type('svg');
    res.status(200).send(captcha.data);
});
//由更改密码的id映射到对应的用户
var changePassworldMap = {}

app.route('/forgot').post(async(req, res, next) => {
        var email = req.body.email
        var user = await db.get('SELECT * FROM users WHERE email = ? ', email)
        if (user) {
            var changePassworId = Math.random().toString(16).slice(2)
            changePassworldMap[changePassworId] = user
            setTimeout(() => {
                delete changePassworldMap[changePassworId]
            }, 1000 * 60 * 10)

            var changePassLink = '/change-password/' + changePassworId
            console.log(changePassLink)
            res.end('A link has send to you email,click the link to change password')
            console.log(changePassworldMap)


        } else {
            res.end('查无此人，该邮箱并非本站的注册邮箱')
        }
    })
    //忘记密码
app.route('/change-password/:id').get(async(req, res, next) => {
        var user = changePassworldMap[req.params.id]
        if (user) {
            res.render('change-password.pug', {
                user: user,
            })
        } else {
            res.end('link has expired')
        }
    })
    .post(async(req, res, next) => {
        var user = changePassworldMap[req.params.id]
        await db.run('update users set password = ? where name =? ', req.body.password, user.name)
        delete changePassworldMap[req.params.id]
        res.end('password change success!')
    })



//登录页面
app.route('/login')
    //打开登录界面
    //发送登录请求
    .post(async(req, res, next) => {
        console.log('收到登录请求', req.body)
        var loginInfo = req.body
        console.log(req.body.captcha)
     
        console.log(req.session)
        if (req.body.captcha !== req.session.captcha) {

            res.json({
                code: 1,
                msg: '验证码错误'
            })
            return
        }


        var user = await db.get(
            'SELECT * FROM users WHERE name = ? AND password = ? ', 
            [loginInfo.name, loginInfo.password])
            console.log(req.get('referer'))
        if (user) {
            res.cookie('user', user.name, {
                maxAge: 8640000,
                signed: true
            })
            res.cookie('username', user.name, {
                maxAge: 8640000,

            })
            res.json({
                code: 0,
                msg: '登录成功,跳回首页',
                user: user
                    // return_url: req.get('referer')
            })

        } else {
            res.json({
                code: 1,
                msg: '登录失败，用户名或者密码错误'
            })

        }
        res.end('ok')

    })
    //退出页面
app.get('/logout', (req, res, next) => {
        res.clearCookie('user')
        res.json({
            codo: 0,
            msg: '退出成功'
        })
    })
app.get('/userinfo',async(req,res,next)=>{
    if(req.user){
        res.json(req.user)
    }else{
        res.status(404).json({
            code:-1,
            msg: '未登录，请登录'
        })
    }
})
    //用户信息
app.get('/user/:id', async(req, res, next) => {
    var userInfo = await db.get('SELECT * FROM users WHERE rowid =?', req.params.id)
    if (userInfo) {
        var userPostsPromise = db.all('SELECT rowid as id,* FROM posts WHERE userId =? ORDER BY createdAt DESC', req.params.id)
        var userCommentsPromise = db.all(
            `SELECT postId,title as postTitle,comments.content,comments.createdAt 
        FROM comments
        JOIN posts ON postId = posts.rowid 
        WHERE comments.userId =? ORDER BY comments.createdAt DESC
        `, req.params.id)
        var [userPosts, userComments] = await Promise.all([userPostsPromise, userCommentsPromise])

        res.render('user-profile.pug', {
            user: req.user,
            userInfo,
            userPosts,
            userComments,
        })

    } else {
        res.end('查无此人')
    }
})
// server.listen(port, '127.0.0.1', () => {
//     console.log('server list ening on port', port)
//         // open('http://localhost:' + port)
// })

servers.listen(443, () => {
	console.log('listening on port 443');
});