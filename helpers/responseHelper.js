/**
 * Helper untuk standarisasi format respon JSON API
 */

const successResponse = (res, data = null, message = 'Berhasil', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data
    });
};

const createdResponse = (res, data = null, message = 'Data berhasil dibuat') => {
    return res.status(201).json({
        success: true,
        message,
        data
    });
};

const errorResponse = (res, message = 'Terjadi kesalahan pada server', statusCode = 500, error = null) => {
    const payload = {
        success: false,
        message
    };

    if (error) {
        payload.error = error;
    }

    return res.status(statusCode).json(payload);
};

const notFoundResponse = (res, message = 'Data tidak ditemukan') => {
    return res.status(404).json({
        success: false,
        message
    });
};

const badRequestResponse = (res, message = 'Input data tidak valid', errors = null) => {
    const payload = {
        success: false,
        message
    };

    if (errors) {
        payload.errors = errors;
    }

    return res.status(400).json(payload);
};

const unauthorizedResponse = (res, message = 'Akses ditolak. Token tidak ditemukan atau tidak valid') => {
    return res.status(401).json({
        success: false,
        message
    });
};

const forbiddenResponse = (res, message = 'Anda tidak memiliki hak akses untuk tindakan ini') => {
    return res.status(403).json({
        success: false,
        message
    });
};

module.exports = {
    successResponse,
    createdResponse,
    errorResponse,
    notFoundResponse,
    badRequestResponse,
    unauthorizedResponse,
    forbiddenResponse
};
