#!/usr/bin/env python3
import logging
import os
import sys
from datetime import datetime, timedelta

from flask import Flask, jsonify, request
from flask_cors import CORS

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

try:
    from elasticsearch import Elasticsearch
    from elasticsearch.exceptions import ConnectionError, RequestError
except ImportError:
    logger.error("elasticsearch module not found. Install with: pip install elasticsearch==7.17.9")
    sys.exit(1)

try:
    from dateutil.parser import parse as parse_date
except ImportError:
    logger.error("python-dateutil module not found. Install with: pip install python-dateutil")
    sys.exit(1)


app = Flask(__name__)
CORS(app)

ES_HOSTS = os.environ.get('ES_HOSTS', 'http://localhost:9200').split(',')
ES_INDEX = os.environ.get('ES_INDEX', 'syscall-aggregations')

SYSCALL_TYPES = ['open', 'openat', 'read', 'write', 'connect', 'close']

es = None


def get_elasticsearch():
    global es
    if es is None or not es.ping():
        logger.info(f"Connecting to Elasticsearch at {ES_HOSTS}")
        try:
            es = Elasticsearch(
                ES_HOSTS,
                timeout=30,
                max_retries=3,
                retry_on_timeout=True
            )
            if es.ping():
                logger.info("Successfully connected to Elasticsearch")
            else:
                logger.warning("Could not ping Elasticsearch")
        except Exception as e:
            logger.error(f"Failed to connect to Elasticsearch: {e}")
            es = None
    return es


@app.route('/api/health', methods=['GET'])
def health_check():
    es_client = get_elasticsearch()
    es_connected = es_client is not None and es_client.ping()
    
    status = 'healthy' if es_connected else 'degraded'
    
    response = {
        'status': status,
        'timestamp': datetime.utcnow().isoformat(),
        'elasticsearch': {
            'connected': es_connected,
            'hosts': ES_HOSTS,
            'index': ES_INDEX
        }
    }
    
    if es_connected:
        try:
            if es_client.indices.exists(index=ES_INDEX):
                stats = es_client.indices.stats(index=ES_INDEX)
                response['elasticsearch']['docs_count'] = stats['indices'][ES_INDEX]['total']['docs']['count']
            else:
                response['elasticsearch']['index_exists'] = False
        except Exception as e:
            response['elasticsearch']['error'] = str(e)
    
    return jsonify(response)


@app.route('/api/syscalls', methods=['GET'])
def get_syscall_frequency():
    tgid = request.args.get('tgid', type=int)
    syscall = request.args.get('syscall', default=None)
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    last_minutes = request.args.get('last_minutes', default=5, type=int)
    
    if not end_time:
        end_time = datetime.utcnow()
    else:
        try:
            end_time = parse_date(end_time)
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Invalid end_time: {e}'
            }), 400
    
    if not start_time:
        start_time = end_time - timedelta(minutes=last_minutes)
    else:
        try:
            start_time = parse_date(start_time)
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Invalid start_time: {e}'
            }), 400
    
    query = {
        'query': {
            'bool': {
                'filter': [
                    {
                        'range': {
                            'windowStart': {
                                'gte': int(start_time.timestamp() * 1000),
                                'lte': int(end_time.timestamp() * 1000)
                            }
                        }
                    }
                ]
            }
        },
        'sort': [
            {'windowStart': {'order': 'asc'}}
        ],
        'size': 10000
    }
    
    if tgid:
        query['query']['bool']['filter'].append({
            'term': {'tgid': tgid}
        })
    
    if syscall:
        query['query']['bool']['filter'].append({
            'term': {'syscall': syscall}
        })
    
    try:
        es_client = get_elasticsearch()
        if not es_client:
            return jsonify({
                'success': False,
                'error': 'Elasticsearch connection not available'
            }), 503
        
        if not es_client.indices.exists(index=ES_INDEX):
            logger.warning(f"Index {ES_INDEX} does not exist yet")
            return jsonify({
                'success': True,
                'count': 0,
                'data': [],
                'message': 'Index does not exist yet. No data has been ingested.'
            })
        
        response = es_client.search(index=ES_INDEX, body=query)
        
        results = []
        for hit in response['hits']['hits']:
            source = hit['_source']
            results.append({
                'timestamp': source.get('timestamp'),
                'tgid': source.get('tgid'),
                'syscall': source.get('syscall'),
                'count': source.get('count'),
                'windowStart': source.get('windowStart'),
                'windowEnd': source.get('windowEnd')
            })
        
        logger.info(f"Query returned {len(results)} results")
        
        return jsonify({
            'success': True,
            'count': len(results),
            'data': results
        })
        
    except ConnectionError as e:
        logger.error(f"Elasticsearch connection error: {e}")
        return jsonify({
            'success': False,
            'error': 'Elasticsearch connection error'
        }), 503
        
    except Exception as e:
        logger.error(f"Error querying Elasticsearch: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/syscalls/by-syscall', methods=['GET'])
def get_syscall_frequency_by_syscall():
    tgid = request.args.get('tgid', type=int)
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    last_minutes = request.args.get('last_minutes', default=5, type=int)
    
    if not end_time:
        end_time = datetime.utcnow()
    else:
        try:
            end_time = parse_date(end_time)
        except:
            end_time = datetime.utcnow()
    
    if not start_time:
        start_time = end_time - timedelta(minutes=last_minutes)
    else:
        try:
            start_time = parse_date(start_time)
        except:
            start_time = end_time - timedelta(minutes=last_minutes)
    
    query = {
        'query': {
            'bool': {
                'filter': [
                    {
                        'range': {
                            'windowStart': {
                                'gte': int(start_time.timestamp() * 1000),
                                'lte': int(end_time.timestamp() * 1000)
                            }
                        }
                    }
                ]
            }
        },
        'aggs': {
            'by_syscall': {
                'terms': {
                    'field': 'syscall.keyword',
                    'size': 100
                },
                'aggs': {
                    'total_count': {
                        'sum': {
                            'field': 'count'
                        }
                    }
                }
            }
        },
        'size': 0
    }
    
    if tgid:
        query['query']['bool']['filter'].append({
            'term': {'tgid': tgid}
        })
    
    try:
        es_client = get_elasticsearch()
        if not es_client or not es_client.indices.exists(index=ES_INDEX):
            return jsonify({
                'success': True,
                'data': []
            })
        
        response = es_client.search(index=ES_INDEX, body=query)
        
        results = []
        if 'aggregations' in response and 'by_syscall' in response['aggregations']:
            for bucket in response['aggregations']['by_syscall']['buckets']:
                results.append({
                    'syscall': bucket['key'],
                    'count': int(bucket['total_count']['value'])
                })
        
        return jsonify({
            'success': True,
            'data': results
        })
        
    except Exception as e:
        logger.error(f"Error in by-syscall query: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'data': []
        }), 500


@app.route('/api/processes', methods=['GET'])
def get_monitored_processes():
    query = {
        'query': {
            'match_all': {}
        },
        'aggs': {
            'by_tgid': {
                'terms': {
                    'field': 'tgid',
                    'size': 100
                },
                'aggs': {
                    'last_activity': {
                        'max': {
                            'field': 'timestamp'
                        }
                    }
                }
            }
        },
        'size': 0
    }
    
    try:
        es_client = get_elasticsearch()
        if not es_client or not es_client.indices.exists(index=ES_INDEX):
            return jsonify({
                'success': True,
                'data': []
            })
        
        response = es_client.search(index=ES_INDEX, body=query)
        
        processes = []
        if 'aggregations' in response and 'by_tgid' in response['aggregations']:
            for bucket in response['aggregations']['by_tgid']['buckets']:
                processes.append({
                    'tgid': bucket['key'],
                    'doc_count': bucket['doc_count'],
                    'last_activity': bucket['last_activity']['value']
                })
        
        return jsonify({
            'success': True,
            'data': processes
        })
        
    except Exception as e:
        logger.error(f"Error querying processes: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'data': []
        }), 500


@app.route('/api/syscalls/timeline', methods=['GET'])
def get_syscall_timeline():
    tgid = request.args.get('tgid', type=int)
    syscalls = request.args.getlist('syscall')
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    last_minutes = request.args.get('last_minutes', default=5, type=int)
    interval_ms = request.args.get('interval', default=1000, type=int)
    
    if not end_time:
        end_time = datetime.utcnow()
    else:
        try:
            end_time = parse_date(end_time)
        except:
            end_time = datetime.utcnow()
    
    if not start_time:
        start_time = end_time - timedelta(minutes=last_minutes)
    else:
        try:
            start_time = parse_date(start_time)
        except:
            start_time = end_time - timedelta(minutes=last_minutes)
    
    filters = [
        {
            'range': {
                'windowStart': {
                    'gte': int(start_time.timestamp() * 1000),
                    'lte': int(end_time.timestamp() * 1000)
                }
            }
        }
    ]
    
    if tgid:
        filters.append({'term': {'tgid': tgid}})
    
    if syscalls:
        filters.append({'terms': {'syscall.keyword': syscalls}})
    
    query = {
        'query': {
            'bool': {
                'filter': filters
            }
        },
        'aggs': {
            'time_buckets': {
                'date_histogram': {
                    'field': 'windowStart',
                    'fixed_interval': f'{interval_ms}ms',
                    'format': 'epoch_millis',
                    'min_doc_count': 0
                },
                'aggs': {
                    'by_syscall': {
                        'terms': {
                            'field': 'syscall.keyword',
                            'size': 100
                        },
                        'aggs': {
                            'total_count': {
                                'sum': {
                                    'field': 'count'
                                }
                            }
                        }
                    }
                }
            }
        },
        'size': 0
    }
    
    try:
        es_client = get_elasticsearch()
        if not es_client or not es_client.indices.exists(index=ES_INDEX):
            return jsonify({
                'success': True,
                'data': []
            })
        
        response = es_client.search(index=ES_INDEX, body=query)
        
        results = []
        if 'aggregations' in response and 'time_buckets' in response['aggregations']:
            for bucket in response['aggregations']['time_buckets']['buckets']:
                timestamp = bucket['key']
                syscall_data = {}
                
                if 'by_syscall' in bucket:
                    for syscall_bucket in bucket['by_syscall']['buckets']:
                        syscall_data[syscall_bucket['key']] = int(syscall_bucket['total_count']['value'])
                
                result = {
                    'timestamp': timestamp,
                    'time_str': bucket['key_as_string']
                }
                
                for syscall in SYSCALL_TYPES:
                    result[syscall] = syscall_data.get(syscall, 0)
                
                results.append(result)
        
        return jsonify({
            'success': True,
            'data': results
        })
        
    except RequestError as e:
        logger.warning(f"Elasticsearch request error: {e}")
        return jsonify({
            'success': True,
            'data': [],
            'warning': 'Elasticsearch query issue - no data yet'
        })
        
    except Exception as e:
        logger.error(f"Error in timeline query: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e),
            'data': []
        }), 500


if __name__ == '__main__':
    logger.info("Starting Syscall Monitor Backend API")
    get_elasticsearch()
    
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    port = int(os.environ.get('PORT', 5000))
    
    app.run(host='0.0.0.0', port=port, debug=debug)
