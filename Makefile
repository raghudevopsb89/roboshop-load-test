load:
	docker rm -f load-test || true
	docker run -d --name load-test --rm -p 4999:4999 load-test

build:
	git pull
	docker build -t load-test .


