import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("dashboard is rooted in the Ant Design provider and App context",async()=>{const [main,pkg]=await Promise.all([read("../src/main.jsx"),read("../../package.json")]);assert.match(main,/ConfigProvider/);assert.match(main,/App as AntApp/);assert.match(main,/antd\/dist\/reset\.css/);assert.match(pkg,/"antd"/);assert.match(pkg,/@ant-design\/icons/);});

test("primary dashboard workflows use Ant Design components",async()=>{const files=await Promise.all([read("../src/App.jsx"),read("../src/pages/admin-pages.jsx"),read("../src/features/applications/application-pages.jsx"),read("../src/features/resume-upload/resume-upload-page.jsx")]);for(const source of files)assert.match(source,/from "antd"/);for(const component of ["Layout","Menu","Table","Form","Upload","Descriptions","Alert","Card"])assert.ok(files.some(source=>source.includes(component)),`${component} is used`);});

test("authenticated shell shows the saved profile name with email fallback",async()=>{const app=await read("../src/App.jsx");assert.match(app,/access\?\.fullName/);assert.match(app,/profileName\s*\|\|\s*access\?\.email/);});

test("dashboard Sider follows the collapsible overlay interaction",async()=>{
  const [app,css]=await Promise.all([read("../src/App.jsx"),read("../src/styles/antd-dashboard.css")]);
  for(const contract of [
    /dashboard-sider-overlay/,
    /collapsed=\{collapsed\}/,
    /trigger=\{null\}/,
    /collapsedWidth=\{narrow \? 0 : 64\}/,
    /sider-edge-trigger/,
    /aria-expanded=\{!collapsed\}/,
    /event\.key\.toLowerCase\(\) === "m"/,
    /event\.key === "Escape"/,
    /PARENT_NAVIGATION/,
    /NAV_ICONS/,
  ])assert.match(app,contract);
  assert.match(css,/position:fixed!important/);
  assert.match(css,/margin-left:64px/);
  assert.match(css,/dashboard-sider-mask/);
  assert.match(css,/@media\(max-width:991px\)/);
});
