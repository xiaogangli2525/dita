'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { readTitle, replaceTitle } = require('../public/map-source');

test('Map title edits preserve declarations, comments, revision PIs, CRLF and all unrelated source', () => {
  const source = '\uFEFF<?xml version="1.0" encoding="GBK"?>\r\n<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">\r\n<!--前言-->\r\n<map id = "http">\r\n  <title outputclass="manual">HTTP &amp; HTTPS</title>\r\n  <?oxy_comment_start author="研发"?><topicref href = "http.dita" /><?oxy_comment_end?>\r\n</map>\r\n<?tail keep?>';
  assert.equal(readTitle(source).text, 'HTTP & HTTPS');
  assert.equal(replaceTitle(source, 'HTTP & HTTPS'), source);
  assert.equal(replaceTitle(source, 'HTTP <新版> & HTTPS'), source.replace('HTTP &amp; HTTPS', 'HTTP &lt;新版&gt; &amp; HTTPS'));
});

test('Bookmap changes only mainbooktitle, preserving library and alternative titles', () => {
  const source = '<bookmap><booktitle><booklibrary>通信模组</booklibrary><mainbooktitle id="name">HTTP</mainbooktitle><booktitlealt>旧版本兼容</booktitlealt></booktitle><chapter href="http.dita"/></bookmap>';
  assert.equal(replaceTitle(source, 'HTTP 更新'), source.replace('>HTTP<', '>HTTP 更新<'));
  assert.equal(readTitle(source).text, 'HTTP');
  const simple = '<bookmap><title id="name">HTTP</title><chapter href="http.dita"/></bookmap>';
  assert.equal(replaceTitle(simple, 'HTTP 更新'), simple.replace('>HTTP<', '>HTTP 更新<'));
  assert.equal(replaceTitle('<bookmap title="HTTP"/>', 'HTTP 更新'), '<bookmap title="HTTP 更新"/>');
});

test('absent and self-closing Map/Bookmap titles insert at their proper structural position', () => {
  const cases = [
    ['<map />', '<map ><title>新增</title></map>'],
    ['<map><title id="title" /><topicref href="a.dita"/></map>', '<map><title id="title" >新增</title><topicref href="a.dita"/></map>'],
    ['<bookmap><chapter href="a.dita"/></bookmap>', '<bookmap><booktitle><mainbooktitle>新增</mainbooktitle></booktitle><chapter href="a.dita"/></bookmap>'],
    ['<bookmap><booktitle /></bookmap>', '<bookmap><booktitle ><mainbooktitle>新增</mainbooktitle></booktitle></bookmap>'],
    ['<bookmap><booktitle><booklibrary>库</booklibrary>\r\n<booktitlealt>副标题</booktitlealt></booktitle></bookmap>', '<bookmap><booktitle><booklibrary>库</booklibrary><mainbooktitle>新增</mainbooktitle>\r\n<booktitlealt>副标题</booktitlealt></booktitle></bookmap>']
  ];
  for (const [source, expected] of cases) assert.equal(replaceTitle(source, '新增'), expected);
});

test('legacy title attributes keep their location, quoting and unrelated attribute values', () => {
  const source = '<map outputclass=" title=\'untouched\' " title = \'HTTP &amp; HTTPS\'><topicref href="a.dita"/></map>';
  assert.equal(readTitle(source).text, 'HTTP & HTTPS');
  assert.equal(replaceTitle(source, "客户的 'HTTP'"), source.replace('HTTP &amp; HTTPS', '客户的 &apos;HTTP&apos;'));
  assert.equal(replaceTitle('<map title="HTTP"/>', '"<&'), '<map title="&quot;&lt;&amp;"/>');
});

test('CDATA titles round-trip and remain editable when their closing delimiter is typed', () => {
  const source = '<map><title><![CDATA[HTTP <参数>]]></title></map>';
  assert.equal(replaceTitle(source, 'HTTP <参数>'), source);
  const changed = replaceTitle(source, '参数 ]]> 值');
  assert.equal(readTitle(changed).text, '参数 ]]> 值');
  assert.equal(readTitle(changed).editable, true);
  assert.equal(readTitle(replaceTitle(changed, '继续编辑')).text, '继续编辑');
});

test('inline markup, review annotations and referenced titles are protected from flattening', () => {
  for (const source of [
    '<map><title>HTTP <b>重要</b></title></map>',
    '<map><title>HTTP<?oxy_comment_start author="研发"?>说明<?oxy_comment_end?></title></map>',
    '<map><title>HTTP<!--retain--></title></map>',
    '<map><title conref="shared.dita#title">HTTP</title></map>',
    '<bookmap><booktitle conref="shared.ditamap#book/title"><mainbooktitle>HTTP</mainbooktitle></booktitle></bookmap>'
  ]) {
    const title = readTitle(source);
    assert.equal(title.editable, false);
    assert.equal(replaceTitle(source, title.text), source);
    assert.throws(() => replaceTitle(source, '替换'), /源码模式/);
  }
});

test('empty titles and XML-special characters stay valid; invalid edits fail without a result', () => {
  assert.equal(replaceTitle('<map><title>HTTP</title></map>', ''), '<map><title></title></map>');
  assert.equal(replaceTitle('<map><title>&#72;TTP</title></map>', 'HTTP'), '<map><title>&#72;TTP</title></map>');
  assert.equal(replaceTitle('<d:map xmlns:d="urn:dita"><d:title>旧</d:title></d:map>', '新'), '<d:map xmlns:d="urn:dita"><d:title>新</d:title></d:map>');
  assert.throws(() => replaceTitle('<map><title>HTTP</title></map>', '\u0000'), /Invalid XML/);
  assert.throws(() => replaceTitle('<topic><title>HTTP</title></topic>', '新版'), /不是 Map/);
});
