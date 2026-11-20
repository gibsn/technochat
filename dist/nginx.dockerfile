FROM nginx:1.31.9@sha256:84f7876d21d154885f99554d7ae325d8c2213f9169726ea7ab60642f2573a787

EXPOSE 80 443

ARG DEV

COPY static /static/
RUN chown -R nginx:nginx /static
COPY dist/process_static.sh ./

RUN if [ "$DEV" != True ]; then /bin/bash ./process_static.sh; fi
RUN ["rm", "-f", "process_static.sh"]
