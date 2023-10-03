FROM alpine:latest

COPY A/ home/user/A/
COPY B/ home/user/B/
COPY C/ home/user/C/

WORKDIR home/user

RUN cp A/a B
RUN rm -rf A
RUN rm B/a

RUN tree .
