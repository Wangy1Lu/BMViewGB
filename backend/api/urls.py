from django.urls import path
from .views import (
    daily_data,
    time_series_data,
    available_variables,
    asset_benchmark_data,
    interconnector_flows,
    nodes_by_zone,
    node_metrics,
)

urlpatterns = [
    path('daily-data/', daily_data, name='daily_data'),
    path('time-series/', time_series_data, name='time_series_data'),
    path('available-variables/', available_variables, name='available_variables'),
    path('asset-benchmark/', asset_benchmark_data, name='asset_benchmark_data'),
    path('interconnector-flows/', interconnector_flows, name='interconnector_flows'),
    path('nodes-by-zone/', nodes_by_zone, name='nodes_by_zone'),
    path('node-metrics/', node_metrics, name='node_metrics'),
]
