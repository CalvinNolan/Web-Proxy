CREATE DATABASE proxy;

USE proxy; 

CREATE TABLE blacklist (
	website varchar(100)
);

CREATE TABLE cache (
	url varchar(1000) PRIMARY KEY,
	time bigint(20),
	data longblob,
	status longblob,
	headers varchar(1000)
);