import axios from 'axios';

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000/api';

export const fetchDailyData = async (date) => {
  const day = String(date.day).padStart(2, '0');
  const month = String(date.month).padStart(2, '0');
  const year = date.year;
  const formattedDate = `${day}-${month}-${year}`;

  try {
    const response = await axios.get(`${API_BASE_URL}/daily-data/`, {
      params: { date: formattedDate }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching daily data:', error);
    throw error;
  }
};

export const fetchInterconnectorFlows = async ({ date, settlementPeriod }) => {
  const day = String(date.day).padStart(2, '0');
  const month = String(date.month).padStart(2, '0');
  const year = date.year;
  const formattedDate = `${day}-${month}-${year}`;

  try {
    const response = await axios.get(`${API_BASE_URL}/interconnector-flows/`, {
      params: {
        date: formattedDate,
        ...(settlementPeriod ? { settlement_period: settlementPeriod } : {})
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching interconnector flows:', error);
    throw error;
  }
};

export const fetchNodesByZone = async (zone, nodeLayer = 'gnode') => {
  try {
    const response = await axios.get(`${API_BASE_URL}/nodes-by-zone/`, {
      params: { zone, node_layer: nodeLayer }
    });

    if (typeof response.data === 'string') {
      return JSON.parse(response.data);
    }

    return response.data;
  } catch (error) {
    console.error('Error fetching nodes by zone:', error);
    throw error;
  }
};

export const fetchNodeMetrics = async ({
  nodeType = 'gnode',
  nodeId,
  gnodeId,
  zone,
  date,
  aggregation,
  timePoint,
}) => {
  const day = String(date.day).padStart(2, '0');
  const month = String(date.month).padStart(2, '0');
  const year = date.year;
  const formattedDate = `${day}-${month}-${year}`;

  try {
    const resolvedNodeId = nodeId || gnodeId;

    const response = await axios.get(`${API_BASE_URL}/node-metrics/`, {
      params: {
        node_type: nodeType,
        node_id: resolvedNodeId,
        gnode_id: resolvedNodeId,
        zone,
        date: formattedDate,
        aggregation,
        ...(aggregation !== 'daily' ? { time_point: timePoint } : {}),
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching node metrics:', error);
    throw error;
  }
};
