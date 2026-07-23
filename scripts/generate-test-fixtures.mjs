import { Document,Packer,Paragraph,TextRun } from "docx";
import PDFDocument from "pdfkit";
import { mkdir,writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
const dir=resolve("tests/fixtures");await mkdir(dir,{recursive:true});const text="SAMPLE CANDIDATE\nSUMMARY\nData engineer with demonstration experience.\nSKILLS\nPython SQL Databricks Snowflake dbt Airflow AWS\nEXPERIENCE\nBuilt reliable data pipelines for fictional projects.";
const doc=new Document({sections:[{children:text.split("\n").map((line)=>new Paragraph({children:[new TextRun(line)]}))}]});await writeFile(resolve(dir,"sample-resume.docx"),await Packer.toBuffer(doc));
await new Promise((resolvePromise,reject)=>{const pdf=new PDFDocument();const stream=createWriteStream(resolve(dir,"sample-resume.pdf"));stream.on("finish",resolvePromise);stream.on("error",reject);pdf.pipe(stream);pdf.fontSize(16).text("SAMPLE CANDIDATE");pdf.fontSize(12).text(text);pdf.end();});
