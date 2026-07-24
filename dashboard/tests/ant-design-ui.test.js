import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("dashboard is rooted in the Ant Design provider and App context",async()=>{const [main,pkg]=await Promise.all([read("../src/main.jsx"),read("../../package.json")]);assert.match(main,/ConfigProvider/);assert.match(main,/App as AntApp/);assert.match(main,/antd\/dist\/reset\.css/);assert.match(pkg,/"antd"/);assert.match(pkg,/@ant-design\/icons/);});

test("primary dashboard workflows use Ant Design components",async()=>{const files=await Promise.all([read("../src/App.jsx"),read("../src/pages/admin-pages.jsx"),read("../src/features/applications/application-pages.jsx"),read("../src/features/resume-upload/resume-upload-page.jsx")]);for(const source of files)assert.match(source,/from "antd"/);for(const component of ["Layout","Menu","Table","Form","Upload","Descriptions","Alert","Card"])assert.ok(files.some(source=>source.includes(component)),`${component} is used`);});
