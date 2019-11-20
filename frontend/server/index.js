import koa from 'koa';
import convert from 'koa-convert';
import onerror from 'koa-onerror';
import serve from 'koa-static';
import historyApiFallback from './middleware/historyApiFallback';
import config from './configs';
import middleware from './middleware';
import api from './api';
import path from 'path';
import fs from 'fs';
import { createBundleRenderer } from 'vue-server-renderer';
const resolve = file => path.resolve(__dirname, file);

const isProd = process.env.NODE_ENV === 'production';
const router = require('koa-router')();
const routerInfo = require('koa-router')();

const app = new koa();

// middleware
app.use(middleware());
onerror(app);

// api/router
app.use(api());

app.use(serve('./client/static'));

// 创建渲染器，开启组件缓存
let renderer;

function createRenderer(bundle, template) {
    return createBundleRenderer(bundle, {
        template,
        cache: require('lru-cache')({
            max: 1000,
            maxAge: 1000 * 60 * 15,
        }),
        runInNewContext: false,
    });
}

// 提示webpack还在工作
routerInfo.get('*', async(ctx, next) => {
    if (!renderer) {
        ctx.body = 'waiting for compilation... refresh in a moment.';
        return ctx.body;
    }
    return next();
});

app.use(routerInfo.routes());


if (isProd) {
    // 生产环境下直接读取构造渲染器
    const bundle = require('../client/dist/vue-ssr-server-bundle.json');
    const template = fs.readFileSync(resolve('../client/dist/front.html'), 'utf-8');
    renderer = createRenderer(bundle, template);
    app.use(serve('./client/dist'));
} else {
    // 开发环境下使用hot/dev middleware拿到bundle与template
    require('../client/build/setup-dev-server')(app, (bundle, template) => {
        renderer = createRenderer(bundle, template);
    });
}

// 流式渲染
router.get('*', async(ctx, next) => {
    let req = ctx.req;
    // 由于koa内有处理type，此处需要额外修改content-type
    ctx.type = 'html';
    const s = Date.now();
    let context = {
        title: 'FuckerBlog',
        url: req.url,
        renderURLScript: (type) => {
            if (config[type].url !== '') {
                return `<script src="${config[type].url}" async></script>`;
            }
            return '';
        },
    };
    // let r = renderer.renderToStream(context)
    //   .on('data', chunk => {
    //     console.log(chunk)
    //     console.log("__________________")
    //   })
    //   .on('end', () => console.log(`whole request: ${Date.now() - s}ms`))
    // ctx.body = r
    function renderToStringPromise() {
        return new Promise((resolve, reject) => {
            renderer.renderToString(context, (err, html) => {
                if (err) {
                    console.log(err);
                }
                if (!isProd) {
                    console.log(`whole request: ${Date.now() - s}ms`);
                }
                resolve(html);
            });
        });
    }
    ctx.body = await renderToStringPromise();
});

app
    .use(router.routes())
    .use(router.allowedMethods());

// create server
app.listen(config.app.port, () => {
    console.log('The server is running at http://localhost:' + config.app.port);
});

export default app;
