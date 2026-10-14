import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XmlError, at, children, parseXml, textAt } from './xml-tree.ts';

test('reads elements, attributes and text by local name', () => {
  const doc = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ns2:Amt xmlns:ns2="x"><InstdAmt Ccy="EUR">12.50</InstdAmt></ns2:Amt>
  <Empty/>
</Document>`);
  assert.equal(doc.name, 'Document');
  assert.equal(doc.attrs.xmlns, 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
  assert.equal(textAt(doc, 'Amt', 'InstdAmt'), '12.50');
  assert.equal(at(doc, 'Amt', 'InstdAmt')?.attrs.Ccy, 'EUR');
  assert.equal(textAt(doc, 'Empty'), null);
  assert.equal(textAt(doc, 'Missing', 'Path'), null);
});

test('resolves the predefined entities and character references, keeps CDATA as text', () => {
  const doc = parseXml('<a><n>M&amp;M &lt;GmbH&gt; &#228;&#xF6; &quot;x&apos;</n><c><![CDATA[<Nm>not a tag</Nm>]]></c></a>');
  assert.equal(textAt(doc, 'n'), 'M&M <GmbH> äö "x\'');
  assert.equal(textAt(doc, 'c'), '<Nm>not a tag</Nm>');
  assert.equal(children(doc, 'Nm').length, 0);
});

test('a comment is no element', () => {
  const doc = parseXml('<a><!-- <Nm>Mallory</Nm> --><Nm>Lea</Nm></a>');
  assert.deepEqual(children(doc, 'Nm').map((n) => n.text), ['Lea']);
});

test('refuses what is not well-formed', () => {
  for (const bad of [
    '<a><b></a>',
    '<a>',
    '<a></a><b></b>',
    'text<a/>',
    '<a>&unknown;</a>',
    '<a>AT&T</a>',
    '<a x=1></a>',
    '<a x="1"y="2"></a>',
    '<!DOCTYPE a [<!ENTITY e "boom">]><a>&e;</a>',
    '',
  ]) {
    assert.throws(() => parseXml(bad), XmlError, bad);
  }
});

test('a byte-order mark and a self-closing root are fine', () => {
  assert.equal(parseXml('﻿<Document/>').name, 'Document');
});
